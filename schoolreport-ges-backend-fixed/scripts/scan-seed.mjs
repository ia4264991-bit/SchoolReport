// Seeds a FRESH local API (never production) with one demo school for the HawkScan scan,
// and hands the scanner what it needs: a pre-issued school-admin token and real record ids.
//
//   SCAN_API=http://127.0.0.1:3001/api node scripts/scan-seed.mjs
//
// On GitHub Actions the values go to $GITHUB_ENV (the token is masked in logs);
// locally they are written to ./scan.env (git-ignored).
import { appendFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.SCAN_API || 'http://127.0.0.1:3001/api'
// The development default superadmin password (the API only uses it when NODE_ENV is not production).
const BOOT_PW = process.env.SCAN_SUPERADMIN_PASSWORD || 'SuperAdmin@2024!'

async function api(method, path, { token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(data)}`)
  return data
}

/** Logs in, changes the temporary password, returns the NEW token (the old one is signed out). */
async function firstLogin(email, temp, final) {
  const r = await api('POST', '/auth/login', { body: { email, password: temp } })
  if (!r.mustChangePassword) return r.token
  return (await api('POST', '/auth/change-password', {
    token: r.token, body: { currentPassword: temp, newPassword: final },
  })).token
}

let up = false
for (let i = 0; i < 60 && !up; i++) {
  try { await api('GET', '/health'); up = true } catch { await new Promise((r) => setTimeout(r, 1000)) }
}
if (!up) throw new Error(`API not reachable at ${BASE}`)

const root = await firstLogin('superadmin@schoolreport.ges', BOOT_PW, 'ScanSuper#2026')
const school = await api('POST', '/superadmin/schools', {
  token: root,
  body: { schoolName: 'Scan Basic School', schoolEmail: 'office@scan.test', adminName: 'Scan Admin', adminEmail: 'admin@scan.test', region: 'Greater Accra' },
})
const admin = await firstLogin('admin@scan.test', school.credentials.password, 'ScanAdmin#2026')
const cls = await api('POST', '/school/classes', { token: admin, body: { name: 'Class 4A', level: 'Primary 4' } })
await api('POST', '/school/classes', { token: admin, body: { name: 'Class 4B', level: 'Primary 4' } })
const subjects = []
for (const [i, name] of ['Mathematics', 'English', 'Science'].entries()) {
  subjects.push(await api('POST', '/school/subjects', { token: admin, body: { name, order: i } }))
}
await api('PUT', '/school/max-marks', { token: admin, body: { [subjects[0]._id]: 30 } })
const teacher = await api('POST', '/users', {
  token: admin, body: { fullName: 'Scan Teacher', email: 'teacher@scan.test', role: 'teacher', classId: cls._id },
})
const students = []
for (const [fullName, gender] of [['Kwame Mensah', 'M'], ['Akosua Boateng', 'F'], ['Yaw Darko', 'M']]) {
  students.push(await api('POST', '/students', { token: admin, body: { fullName, gender, classId: cls._id, dateOfBirth: '2016-05-01' } }))
}
const scores = {}
for (const s of students) scores[s._id] = Object.fromEntries(subjects.map((sub) => [sub._id, { classScore: 20, examScore: 70 }]))
await api('POST', `/scores/${cls._id}/1/bulk`, { token: admin, body: { scores } })
const saved = await api('GET', `/scores/${cls._id}/1`, { token: admin })

const out = {
  SCAN_TOKEN: admin,
  SCAN_SCHOOL_ID: school.school._id,
  SCAN_CLASS_ID: cls._id,
  SCAN_SUBJECT_ID: subjects[1]._id,
  SCAN_STUDENT_ID: students[0]._id,
  SCAN_USER_ID: teacher.user._id,
  SCAN_SCORE_ID: saved[0]._id,
}
const lines = Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
if (process.env.GITHUB_ENV) {
  console.log(`::add-mask::${admin}`)
  appendFileSync(process.env.GITHUB_ENV, lines)
} else {
  writeFileSync('scan.env', lines, { mode: 0o600 })
}
console.log('Seeded scan data:', Object.keys(out).filter((k) => k !== 'SCAN_TOKEN').join(', '), '+ admin token')
