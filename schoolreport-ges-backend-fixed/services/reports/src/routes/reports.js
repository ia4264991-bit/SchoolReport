import { Router } from 'express'
import { query, withTransaction } from '../../../../shared/db.js'
import { ah, HttpError, idParam, termParam, str } from '../../../../shared/http.js'
import { audit } from '../../../../shared/audit.js'
import { requireAuth, requireRole, requireSchool, assertClassAccess } from '../middleware/auth.js'
import { ensureSettings } from '../../../school/src/models/index.js'
import { scoreToApi, weightedTotal } from '../models/Score.js'

// Two routers, mounted in the main server:
//   scoresRouter  → /api/scores
//   reportsRouter → /api/reports
// Every score belongs to an academic year. Reads use ?academicYear=… when given,
// otherwise the school's current year from Settings; writes always use the current year.

const sid = (req) => req.user.schoolId

async function academicYearFor(req, { allowQuery = true } = {}) {
  if (allowQuery && req.query.academicYear) return str(req.query.academicYear, 'Academic year', { max: 20 })
  return (await ensureSettings(sid(req))).academic_year
}

/** Loads a student of the caller's school and checks the caller may see their class. */
async function studentWithAccess(req, studentId) {
  if (req.user.role === 'student') throw new HttpError(403, 'Student accounts cannot view score records.')
  const id = idParam(studentId, 'Student')
  const { rows } = await query('SELECT id, class_id FROM students WHERE id = $1 AND school_id = $2', [id, sid(req)])
  const s = rows[0]
  if (!s || (req.user.role === 'teacher' && s.class_id !== req.user.classId)) {
    throw new HttpError(404, 'Student not found.')
  }
  return s
}

async function studentScores(req, res) {
  const student = await studentWithAccess(req, req.params.studentId)
  const term = termParam(req.params.term)
  const { rows } = await query(
    `SELECT * FROM scores
      WHERE school_id = $1 AND student_id = $2 AND academic_year = $3 AND term = $4`,
    [sid(req), student.id, await academicYearFor(req), term]
  )
  res.json(rows.map(scoreToApi))
}

// ══════════════════════════════════════════════════════
//  SCORES ROUTER (mounted at /api/scores)
// ══════════════════════════════════════════════════════
export const scoresRouter = Router()
scoresRouter.use(requireAuth, requireSchool)

/* GET /api/scores/student/:studentId/:term
   Defined before /:classId/:term so "student" is not read as a class id. */
scoresRouter.get('/student/:studentId/:term', ah(studentScores))

/* GET /api/scores/:classId/:term */
scoresRouter.get('/:classId/:term', ah(async (req, res) => {
  const cls = await assertClassAccess(req, req.params.classId)
  const term = termParam(req.params.term)
  const { rows } = await query(
    `SELECT * FROM scores
      WHERE school_id = $1 AND class_id = $2 AND academic_year = $3 AND term = $4`,
    [sid(req), cls.id, await academicYearFor(req), term]
  )
  res.json(rows.map(scoreToApi))
}))

/** Turns '' / null / undefined into null; anything else must be a number within [0, max]. */
function scoreValue(raw, max, label) {
  if (raw === '' || raw === null || raw === undefined) return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${label} must be between 0 and ${max}`)
  return Math.round(n * 100) / 100
}

/* POST /api/scores/:classId/:term/bulk
   Body: { scores: { [studentId]: { [subjectId]: { classScore, examScore } } } }
   A subject with both fields empty deletes that saved score. */
scoresRouter.post('/:classId/:term/bulk', ah(async (req, res) => {
  const cls = await assertClassAccess(req, req.params.classId)
  const term = termParam(req.params.term)
  const scores = req.body?.scores
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
    throw new HttpError(400, 'Send scores as { studentId: { subjectId: { classScore, examScore } } }.')
  }
  const academicYear = await academicYearFor(req, { allowQuery: false })

  // What may be written: active students of this class, subjects of this school.
  const [studentsRes, subjectsRes] = await Promise.all([
    query('SELECT id, full_name FROM students WHERE school_id = $1 AND class_id = $2 AND is_active', [sid(req), cls.id]),
    query('SELECT id, name, max_class_score FROM subjects WHERE school_id = $1', [sid(req)]),
  ])
  const students = new Map(studentsRes.rows.map((s) => [s.id, s.full_name]))
  const subjects = new Map(subjectsRes.rows.map((s) => [s.id, s]))

  const upserts = { student: [], subject: [], cs: [], es: [] }
  const clears = { student: [], subject: [] }
  const problems = []

  for (const [studentId, perSubject] of Object.entries(scores)) {
    if (!students.has(studentId)) {
      problems.push(`Student ${studentId} is not in this class`)
      continue
    }
    if (!perSubject || typeof perSubject !== 'object') continue
    for (const [subjectId, vals] of Object.entries(perSubject)) {
      const subject = subjects.get(subjectId)
      if (!subject) {
        problems.push(`Unknown subject ${subjectId}`)
        continue
      }
      try {
        const max = subject.max_class_score > 0 ? subject.max_class_score : 100
        const who = `${students.get(studentId)} — ${subject.name}`
        const cs = scoreValue(vals?.classScore, max, `${who}: class score`)
        const es = scoreValue(vals?.examScore, 100, `${who}: exam score`)
        if (cs === null && es === null) {
          clears.student.push(studentId)
          clears.subject.push(subjectId)
        } else {
          upserts.student.push(studentId)
          upserts.subject.push(subjectId)
          upserts.cs.push(cs ?? 0)
          upserts.es.push(es ?? 0)
        }
      } catch (err) {
        problems.push(err.message)
      }
    }
  }
  if (problems.length) {
    const more = problems.length > 5 ? ` (and ${problems.length - 5} more)` : ''
    throw new HttpError(400, `Nothing was saved. ${problems.slice(0, 5).join('; ')}${more}.`)
  }

  await withTransaction(async (db) => {
    // Current values, to record which existing marks this save changes or clears.
    const touched = [...new Set([...upserts.student, ...clears.student])]
    const { rows: existingRows } = touched.length
      ? await db.query(
          `SELECT student_id, subject_id, class_score, exam_score FROM scores
            WHERE school_id = $1 AND academic_year = $2 AND term = $3 AND student_id = ANY($4::uuid[])
            FOR UPDATE`,
          [sid(req), academicYear, term, touched])
      : { rows: [] }
    const existing = new Map(existingRows.map((r) => [`${r.student_id}|${r.subject_id}`, r]))
    const label = (st, su) => `${students.get(st)} — ${subjects.get(su).name}`
    const modified = []
    let added = 0
    upserts.student.forEach((st, i) => {
      const su = upserts.subject[i]
      const old = existing.get(`${st}|${su}`)
      if (!old) { added++; return }
      if (old.class_score !== upserts.cs[i] || old.exam_score !== upserts.es[i]) {
        modified.push({ studentId: st, subjectId: su, what: label(st, su),
          classScore: [old.class_score, upserts.cs[i]], examScore: [old.exam_score, upserts.es[i]] })
      }
    })
    const removed = clears.student
      .map((st, i) => ({ st, su: clears.subject[i], old: existing.get(`${st}|${clears.subject[i]}`) }))
      .filter((c) => c.old)
      .map((c) => ({ studentId: c.st, subjectId: c.su, what: label(c.st, c.su),
        classScore: c.old.class_score, examScore: c.old.exam_score }))

    if (upserts.student.length) {
      await db.query(
        `INSERT INTO scores (school_id, class_id, academic_year, term, student_id, subject_id, class_score, exam_score)
         SELECT $1, $2, $3, $4, u.student_id, u.subject_id, u.class_score, u.exam_score
           FROM unnest($5::uuid[], $6::uuid[], $7::numeric[], $8::numeric[])
                AS u(student_id, subject_id, class_score, exam_score)
         ON CONFLICT ON CONSTRAINT scores_one_per_subject DO UPDATE
            SET class_id = EXCLUDED.class_id,
                class_score = EXCLUDED.class_score,
                exam_score = EXCLUDED.exam_score`,
        [sid(req), cls.id, academicYear, term, upserts.student, upserts.subject, upserts.cs, upserts.es]
      )
    }
    if (clears.student.length) {
      await db.query(
        `DELETE FROM scores sc
          USING unnest($4::uuid[], $5::uuid[]) AS c(student_id, subject_id)
          WHERE sc.school_id = $1 AND sc.academic_year = $2 AND sc.term = $3
            AND sc.student_id = c.student_id AND sc.subject_id = c.subject_id`,
        [sid(req), academicYear, term, clears.student, clears.subject]
      )
    }
    if (added || modified.length || removed.length) {
      await audit(req, 'scores.save', {
        db, targetType: 'class', targetId: cls.id,
        details: { class: cls.name, academicYear, term, added, modified, removed },
      })
    }
  })

  res.json({
    message: `${upserts.student.length} score entries saved.`,
    saved: upserts.student.length,
    cleared: clears.student.length,
  })
}))

/* PUT /api/scores/:id  { classScore?, examScore? } */
scoresRouter.put('/:id', ah(async (req, res) => {
  const id = idParam(req.params.id, 'Score')
  const { rows } = await query(
    `SELECT sc.*, su.max_class_score, su.name AS subject_name
       FROM scores sc JOIN subjects su ON su.id = sc.subject_id
      WHERE sc.id = $1 AND sc.school_id = $2`,
    [id, sid(req)]
  )
  const score = rows[0]
  if (!score) throw new HttpError(404, 'Score not found.')
  await assertClassAccess(req, score.class_id)

  let cs, es
  try {
    const max = score.max_class_score > 0 ? score.max_class_score : 100
    cs = req.body?.classScore === undefined ? score.class_score : scoreValue(req.body.classScore, max, 'Class score') ?? 0
    es = req.body?.examScore === undefined ? score.exam_score : scoreValue(req.body.examScore, 100, 'Exam score') ?? 0
  } catch (err) {
    throw new HttpError(400, err.message)
  }

  const updated = await query(
    'UPDATE scores SET class_score = $2, exam_score = $3 WHERE id = $1 RETURNING *',
    [id, cs, es]
  )
  if (cs !== score.class_score || es !== score.exam_score) {
    await audit(req, 'score.update', {
      targetType: 'score', targetId: id,
      details: { studentId: score.student_id, subject: score.subject_name, academicYear: score.academic_year,
        term: score.term, classScore: [score.class_score, cs], examScore: [score.exam_score, es] },
    })
  }
  res.json(scoreToApi(updated.rows[0]))
}))

/* DELETE /api/scores/:classId/:term — clear a class's scores for the current year */
scoresRouter.delete('/:classId/:term', requireRole('admin'), ah(async (req, res) => {
  const cls = await assertClassAccess(req, req.params.classId)
  const term = termParam(req.params.term)
  const academicYear = await academicYearFor(req, { allowQuery: false })
  const result = await query(
    'DELETE FROM scores WHERE school_id = $1 AND class_id = $2 AND academic_year = $3 AND term = $4',
    [sid(req), cls.id, academicYear, term]
  )
  await audit(req, 'scores.clear_class', {
    targetType: 'class', targetId: cls.id,
    details: { class: cls.name, academicYear, term, deleted: result.rowCount },
  })
  res.json({ message: `${result.rowCount} scores deleted.` })
}))

// ══════════════════════════════════════════════════════
//  REPORTS ROUTER (mounted at /api/reports)
// ══════════════════════════════════════════════════════
export const reportsRouter = Router()
reportsRouter.use(requireAuth)

/* GET /api/reports/me?term=1&academicYear=2026/2027 — a student login's OWN report.
   The class ranking is computed here so the student never receives classmates' marks. */
reportsRouter.get('/me', requireSchool, requireRole('student'), ah(async (req, res) => {
  if (!req.user.studentId) {
    throw new HttpError(404, 'Your login is not linked to a student yet. Ask your school admin.')
  }
  const settings = await ensureSettings(sid(req))
  const term = req.query.term ? termParam(String(req.query.term)) : settings.term
  const academicYear = req.query.academicYear
    ? str(req.query.academicYear, 'Academic year', { max: 20 })
    : settings.academic_year

  const { rows: [student] } = await query(
    `SELECT s.id, s.full_name, s.gender, s.date_of_birth, s.class_id, c.name AS class_name, c.level AS class_level
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.id = $1 AND s.school_id = $2 AND s.is_active`,
    [req.user.studentId, sid(req)]
  )
  if (!student) throw new HttpError(404, 'Your student record is no longer active. Ask your school admin.')

  const { rows: subjects } = await query(
    'SELECT id, name, max_class_score FROM subjects WHERE school_id = $1 ORDER BY sort_order, name',
    [sid(req)]
  )
  // Every active classmate's scores for this term — used only to compute the ranking.
  const { rows: classScores } = await query(
    `SELECT st.id AS student_id, sc.subject_id, sc.class_score, sc.exam_score
       FROM students st
       LEFT JOIN scores sc ON sc.student_id = st.id AND sc.academic_year = $3 AND sc.term = $4
      WHERE st.school_id = $1 AND st.class_id = $2 AND st.is_active`,
    [sid(req), student.class_id, academicYear, term]
  )

  // Average of the weighted subject totals (a missing score counts as 0) — the same rule as
  // the Reports page; averages equal to one decimal share a position (1st, 2nd, 2nd, 4th).
  const maxBySubject = new Map(subjects.map((s) => [s.id, s.max_class_score]))
  const totals = new Map()
  for (const r of classScores) {
    if (!totals.has(r.student_id)) totals.set(r.student_id, 0)
    if (r.subject_id && maxBySubject.has(r.subject_id)) {
      totals.set(r.student_id, totals.get(r.student_id) + weightedTotal(r.class_score, r.exam_score, maxBySubject.get(r.subject_id)))
    }
  }
  const avg = (id) => (subjects.length ? totals.get(id) / subjects.length : 0)
  const rounded = (id) => Math.round(avg(id) * 10)
  const mine = rounded(student.id)
  const position = 1 + [...totals.keys()].filter((id) => rounded(id) > mine).length

  res.json({
    academicYear,
    term,
    student: { fullName: student.full_name, gender: student.gender, dateOfBirth: student.date_of_birth },
    class: { name: student.class_name || '', level: student.class_level || '' },
    subjects: subjects.map((s) => ({ _id: s.id, name: s.name, maxClassScore: s.max_class_score })),
    scores: classScores
      .filter((r) => r.student_id === student.id && r.subject_id)
      .map((r) => ({ subjectId: r.subject_id, classScore: r.class_score, examScore: r.exam_score })),
    position,
    classSize: totals.size,
  })
}))

/* GET /api/reports/student/:studentId/:term */
reportsRouter.get('/student/:studentId/:term', requireSchool, ah(studentScores))

/* GET /api/reports/class/:classId/:term — scores grouped by student */
reportsRouter.get('/class/:classId/:term', requireSchool, ah(async (req, res) => {
  const cls = await assertClassAccess(req, req.params.classId)
  const term = termParam(req.params.term)
  const { rows } = await query(
    `SELECT * FROM scores
      WHERE school_id = $1 AND class_id = $2 AND academic_year = $3 AND term = $4`,
    [sid(req), cls.id, await academicYearFor(req), term]
  )
  const grouped = {}
  for (const r of rows) (grouped[r.student_id] ||= []).push(scoreToApi(r))
  res.json(grouped)
}))

/* GET /api/reports/school/:schoolId/analytics — average weighted total, overall and per class */
reportsRouter.get('/school/:schoolId/analytics', requireRole('admin', 'head', 'superadmin'), ah(async (req, res) => {
  const schoolId = idParam(req.params.schoolId, 'School')
  if (req.user.role !== 'superadmin' && schoolId !== sid(req)) throw new HttpError(403, 'Access denied.')

  const { rows: settingsRows } = await query('SELECT academic_year FROM school_settings WHERE school_id = $1', [schoolId])
  const academicYear = req.query.academicYear
    ? str(req.query.academicYear, 'Academic year', { max: 20 })
    : settingsRows[0]?.academic_year
  if (!academicYear) return res.json({ totalEntries: 0, avgScore: 0, classBreakdown: {} })

  const { rows } = await query(
    `SELECT sc.class_id, sc.class_score, sc.exam_score, su.max_class_score
       FROM scores sc JOIN subjects su ON su.id = sc.subject_id
      WHERE sc.school_id = $1 AND sc.academic_year = $2`,
    [schoolId, academicYear]
  )
  let sum = 0
  const classBreakdown = {}
  for (const r of rows) {
    const t = weightedTotal(r.class_score, r.exam_score, r.max_class_score)
    sum += t
    const c = (classBreakdown[r.class_id] ||= { count: 0, total: 0 })
    c.count++
    c.total += t
  }
  res.json({
    academicYear,
    totalEntries: rows.length,
    avgScore: rows.length ? Number((sum / rows.length).toFixed(1)) : 0,
    classBreakdown,
  })
}))

// Default export kept for backward compatibility (unused internally)
export default scoresRouter
