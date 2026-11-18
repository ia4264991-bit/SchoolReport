// GES grading, shared by the staff Reports page and the student's own report.
// Weighting: class score converted to 40% (out of each subject's max mark, 100 if unset),
// exam score (out of 100) converted to 60%.

export const GRADES = [
  { min: 80, grade: 'A1', remark: 'Excellent' },
  { min: 70, grade: 'B2', remark: 'Very Good' },
  { min: 60, grade: 'B3', remark: 'Good' },
  { min: 55, grade: 'C4', remark: 'Credit' },
  { min: 50, grade: 'C5', remark: 'Credit' },
  { min: 45, grade: 'C6', remark: 'Credit' },
  { min: 40, grade: 'D7', remark: 'Pass' },
  { min: 35, grade: 'E8', remark: 'Pass' },
  { min: 0,  grade: 'F9', remark: 'Fail' },
]

export function gradeInfo(total) {
  for (const g of GRADES) {
    if (parseFloat(total) >= g.min) return g
  }
  return { grade: '—', remark: '—' }
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd", 113 → "113th" */
export function ordinal(n) {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}

/**
 * One report row per subject. `entryFor(subjectId)` returns { classScore, examScore } or
 * undefined (a missing score counts as 0); `maxFor(subjectId)` the class-score maximum.
 */
export function buildRows(subjects, entryFor, maxFor) {
  return subjects.map((sub) => {
    const entry = entryFor(sub._id)
    const max = maxFor(sub._id) || 100
    const cs = parseFloat(entry?.classScore || 0)
    const es = parseFloat(entry?.examScore || 0)
    const csConverted = (cs / max) * 40
    const esConverted = (es / 100) * 60
    const total = csConverted + esConverted
    const { grade, remark } = gradeInfo(total)
    return { subject: sub.name, cs, es, csConverted, esConverted, total, grade, remark }
  })
}

/** Total and average of a set of rows. */
export function summarize(rows) {
  const totalMark = rows.reduce((a, r) => a + r.total, 0)
  return { totalMark, avg: rows.length ? totalMark / rows.length : 0 }
}
