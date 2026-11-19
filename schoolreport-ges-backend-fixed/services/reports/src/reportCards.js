import { query } from '../../../shared/db.js'
import { HttpError } from '../../../shared/http.js'
import { gradeFor, subjectTotal, rankBy, DEFAULT_SCALE } from '../../../shared/grading.js'
import { ensureSettings } from '../../school/src/models/index.js'
import { termAttendance } from '../../students/src/attendanceTotals.js'

const round1 = (n) => Math.round(n * 10) / 10

/**
 * Builds the terminal report cards of a class for one term — the single source for the
 * staff Reports page, bulk printing, the broadsheet, the results SMS and the parent and
 * student views (those receive only their own card; the ranking is still computed over
 * the whole class here, so no classmate's marks leave the server).
 *
 * A missing score counts as 0. Position: average of the subject totals over all subjects,
 * equal averages (to one decimal) share a place. Subject position: rank in that subject.
 */
export async function buildClassReports({ schoolId, classId, academicYear, term }) {
  const settings = await ensureSettings(schoolId)
  academicYear = academicYear || settings.academic_year
  term = term || settings.term
  const scale = settings.grading_scale?.bands ? settings.grading_scale : DEFAULT_SCALE
  const weight = settings.class_score_weight ?? 40

  const [{ rows: [cls] }, { rows: subjects }, { rows: students }, { rows: [logo] }] = await Promise.all([
    query('SELECT id, name, level FROM classes WHERE id = $1 AND school_id = $2', [classId, schoolId]),
    query('SELECT id, name, code, max_class_score FROM subjects WHERE school_id = $1 ORDER BY sort_order, name', [schoolId]),
    query(
      `SELECT id, full_name, gender, date_of_birth FROM students
        WHERE school_id = $1 AND class_id = $2 AND is_active ORDER BY full_name`,
      [schoolId, classId]),
    query('SELECT sha256 FROM school_logos WHERE school_id = $1', [schoolId]),
  ])
  if (!cls) throw new HttpError(404, 'Class not found.')
  const ids = students.map((s) => s.id)

  const [{ rows: scores }, { rows: remarks }, attendance] = await Promise.all([
    query(
      `SELECT student_id, subject_id, class_score, exam_score FROM scores
        WHERE school_id = $1 AND academic_year = $2 AND term = $3 AND student_id = ANY($4::uuid[])`,
      [schoolId, academicYear, term, ids]),
    query(
      `SELECT * FROM report_remarks
        WHERE school_id = $1 AND academic_year = $2 AND term = $3 AND student_id = ANY($4::uuid[])`,
      [schoolId, academicYear, term, ids]),
    termAttendance(schoolId, ids, academicYear, term),
  ])

  const scoreOf = new Map(scores.map((s) => [`${s.student_id}|${s.subject_id}`, s]))
  const remarkOf = new Map(remarks.map((r) => [r.student_id, r]))

  const cards = students.map((st) => {
    let scored = 0
    const rows = subjects.map((su) => {
      const sc = scoreOf.get(`${st.id}|${su.id}`)
      if (sc) scored++
      const max = su.max_class_score > 0 ? su.max_class_score : 100
      const cs = sc?.class_score ?? 0
      const es = sc?.exam_score ?? 0
      const total = subjectTotal(cs, es, max, weight)
      const band = gradeFor(scale.bands, total)
      return {
        subjectId: su.id,
        subject: su.name,
        hasScore: Boolean(sc),
        classScore: cs,
        examScore: es,
        classScoreOutOf: max,
        classScoreWeighted: round1((cs / max) * weight),
        examScoreWeighted: round1((es / 100) * (100 - weight)),
        total: round1(total),
        grade: band.grade,
        remark: band.remark,
      }
    })
    const totalMark = rows.reduce((a, r) => a + r.total, 0)
    const average = subjects.length ? totalMark / subjects.length : 0
    const overall = gradeFor(scale.bands, average)
    const rm = remarkOf.get(st.id)
    const att = attendance.get(st.id)
    return {
      student: { _id: st.id, fullName: st.full_name, gender: st.gender, dateOfBirth: st.date_of_birth },
      rows,
      subjectsScored: scored,
      totalMark: round1(totalMark),
      average: round1(average),
      grade: overall.grade,
      gradeRemark: overall.remark,
      attendance: att ? { present: att.present, total: att.total } : { present: 0, total: 0 },
      remarks: {
        conduct: rm?.conduct || '',
        attitude: rm?.attitude || '',
        interest: rm?.interest || '',
        teacherRemark: rm?.teacher_remark || '',
        headRemark: rm?.head_remark || '',
        promotedTo: rm?.promoted_to || '',
      },
    }
  })

  // Overall position, and position in each subject.
  const pos = rankBy(cards.map((c) => ({ id: c.student._id, value: c.average })))
  cards.forEach((c) => { c.position = pos.get(c.student._id) })
  subjects.forEach((su, i) => {
    const sp = rankBy(cards.map((c) => ({ id: c.student._id, value: c.rows[i].total })))
    cards.forEach((c) => { c.rows[i].position = sp.get(c.student._id) })
  })

  return {
    academicYear,
    term,
    school: {
      name: settings.school_name,
      circuit: settings.circuit,
      district: settings.district,
      region: settings.region,
      headTeacher: settings.head_teacher,
      nextTermDate: settings.next_term_date || '',
      logoVersion: logo ? logo.sha256.slice(0, 16) : null,
    },
    class: { _id: cls.id, name: cls.name, level: cls.level },
    subjects: subjects.map((s) => ({ _id: s.id, name: s.name, code: s.code })),
    weights: { classScore: weight, exam: 100 - weight },
    gradingScale: scale.bands,
    classSize: cards.length,
    cards,
  }
}

/** Only one pupil's card (for parents and student logins), with the class context. */
export async function buildOneReport({ schoolId, studentId, academicYear, term }) {
  const { rows: [st] } = await query(
    'SELECT class_id FROM students WHERE id = $1 AND school_id = $2 AND is_active', [studentId, schoolId]
  )
  if (!st) throw new HttpError(404, 'This pupil is no longer on the school roll. Contact the school.')
  if (!st.class_id) throw new HttpError(404, 'This pupil has no class yet. Contact the school.')
  const all = await buildClassReports({ schoolId, classId: st.class_id, academicYear, term })
  const card = all.cards.find((c) => c.student._id === studentId)
  const { cards: _all, ...context } = all
  return { ...context, card }
}
