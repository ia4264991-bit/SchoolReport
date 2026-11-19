/*
 * Reads a class list from Excel (.xlsx) or CSV and turns it into pupils ready for
 * POST /students/bulk. Columns are found by their heading, in any order:
 *   Name (or First name + Surname), Gender / Sex, Date of birth, Class,
 *   Parent / guardian name, Parent phone (a second phone column is the second number)
 */

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

const COLUMNS = [
  ['fullName', (h) => /^(full name|name|names|pupil|pupils name|pupil name|student|student name|students name|name of pupil)$/.test(h)],
  ['firstName', (h) => /^(first name|first names|other names|other name|given names?|forename)$/.test(h)],
  ['surname', (h) => /^(surname|last name|family name)$/.test(h)],
  ['gender', (h) => /^(gender|sex|m f|boy girl)$/.test(h)],
  ['dateOfBirth', (h) => /(date of birth|^dob$|birth date|birthday)/.test(h)],
  ['className', (h) => /^(class|class name|form|grade|level|stage)$/.test(h)],
  ['guardianName', (h) => /(parent|guardian|father|mother)/.test(h) && !/(phone|contact|mobile|tel|number)/.test(h)],
  ['phone', (h) => /(phone|contact|mobile|tel|number|momo)/.test(h)],
]

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const heads = rows[i].map(norm)
    const map = {}
    const phones = []
    heads.forEach((h, col) => {
      if (!h) return
      for (const [key, test] of COLUMNS) {
        if (!test(h)) continue
        if (key === 'phone') phones.push(col)
        else if (map[key] === undefined) map[key] = col
        break
      }
    })
    if (map.fullName !== undefined || (map.firstName !== undefined && map.surname !== undefined)) {
      return { row: i, map, phones }
    }
  }
  return null
}

function gender(v) {
  const s = norm(v)
  if (['m', 'male', 'boy', 'b'].includes(s)) return 'M'
  if (['f', 'female', 'girl', 'g'].includes(s)) return 'F'
  return null
}

const pad = (n) => String(n).padStart(2, '0')
/** A real calendar day (rejects 31/02). */
const realDay = (s) => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null
}

/** Excel date, "DD/MM/YYYY" (Ghana writes the day first), "YYYY-MM-DD" → "YYYY-MM-DD" or null. */
function date(v) {
  const out = rawDate(v)
  return out ? realDay(out) : out
}

function rawDate(v) {
  if (v === null || v === undefined || v === '') return ''
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m && Number(m[2]) <= 12 && Number(m[1]) <= 31) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  return null
}

function phone(v) {
  if (v === null || v === undefined || v === '') return ''
  const digits = String(typeof v === 'number' ? Math.round(v) : v).replace(/[^\d+]/g, '')
  return digits
}

const title = (s) => String(s ?? '').trim().replace(/\s+/g, ' ')

/** Same rule as the server: a Ghana number (+233 / 0 / 9 digits). */
export function ghanaPhoneOk(v) {
  if (!v) return true
  let d = String(v).replace(/[\s\-().]/g, '')
  if (d.startsWith('+233')) d = d.slice(4)
  else if (d.startsWith('00233')) d = d.slice(5)
  else if (d.startsWith('233') && d.length === 12) d = d.slice(3)
  else if (d.startsWith('0') && d.length === 10) d = d.slice(1)
  return /^[235]\d{8}$/.test(d)
}

/** Parses CSV text (quoted fields, commas or semicolons) into rows. */
export function parseCsv(text) {
  // Semicolons (Excel in some locales) or commas: whichever the first lines use more.
  const head = text.split('\n').slice(0, 5).join('\n')
  const sep = (head.match(/;/g) || []).length > (head.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let row = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''))
}

export async function readRows(file) {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCsv(await file.text())
  if (/\.xls$/i.test(file.name)) throw new Error('This is an old Excel file (.xls). In Excel choose File → Save As → Excel Workbook (.xlsx), then upload that.')
  const { readSheet } = await import('read-excel-file/browser')
  return readSheet(file)
}

/**
 * rows → { pupils: [{ row, data, error, duplicate }], found: [column keys] }
 * classes: [{ _id, name }] · defaultClassId: used when the sheet has no Class column
 * existing: Set of "classId|lowercase name" already on the roll
 */
export function toPupils(rows, { classes, defaultClassId, existing }) {
  const header = findHeader(rows)
  if (!header) throw new Error('Could not find a "Name" column. The first row should have headings such as Name, Gender, Date of birth, Parent phone.')
  const { map, phones } = header
  const byName = new Map(classes.map((c) => [norm(c.name), c._id]))
  const cell = (r, key) => (map[key] === undefined ? '' : r[map[key]])
  const pupils = []
  rows.slice(header.row + 1).forEach((r, i) => {
    const fullName = map.fullName !== undefined
      ? title(cell(r, 'fullName'))
      : title(`${title(cell(r, 'firstName'))} ${title(cell(r, 'surname'))}`)
    if (!fullName) return
    const problems = []
    const g = gender(cell(r, 'gender'))
    if (!g) problems.push('gender must be M or F')
    const dob = date(cell(r, 'dateOfBirth'))
    if (dob === null) problems.push('date of birth not understood (use DD/MM/YYYY)')
    let classId = defaultClassId || ''
    if (map.className !== undefined && title(cell(r, 'className'))) {
      classId = byName.get(norm(cell(r, 'className'))) || ''
      if (!classId) problems.push(`class "${title(cell(r, 'className'))}" does not exist`)
    } else if (!classId) problems.push('no class')
    const data = {
      fullName,
      gender: g || '',
      dateOfBirth: dob || '',
      classId,
      guardianName: title(cell(r, 'guardianName')),
      guardianPhone: phones[0] !== undefined ? phone(r[phones[0]]) : '',
      guardianPhone2: phones[1] !== undefined ? phone(r[phones[1]]) : '',
    }
    if (!ghanaPhoneOk(data.guardianPhone)) problems.push('parent phone is not a Ghana number')
    if (!ghanaPhoneOk(data.guardianPhone2)) problems.push('second phone is not a Ghana number')
    pupils.push({
      row: header.row + i + 2,
      data,
      error: problems.join('; '),
      duplicate: Boolean(classId && existing.has(`${classId}|${fullName.toLowerCase()}`)),
    })
  })
  return { pupils, found: Object.keys(map).concat(phones.length ? ['phone'] : []) }
}

/** A CSV template that opens in Excel. */
export function templateCsv() {
  return [
    'Full name,Gender,Date of birth,Class,Parent name,Parent phone,Second phone',
    'Kwame Mensah,M,14/03/2017,Basic 3,Mrs Akosua Mensah,024 412 3456,',
    'Ama Owusu,F,02/11/2016,Basic 3,Mr Kofi Owusu,020 111 2223,055 000 1112',
  ].join('\r\n')
}
