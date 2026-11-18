import { Router } from 'express'
import { query, withTransaction } from '../../../../shared/db.js'
import {
  ah, HttpError, isUuid, str, requiredStr, idParam, dateOrNull, TERMS,
} from '../../../../shared/http.js'
import {
  schoolToApi, settingsToApi, classToApi, subjectToApi, ensureSettings,
} from '../models/index.js'
import { requireAuth, requireRole, requireSchool } from '../middleware/auth.js'

const router = Router()
// Mounted at: /api/school

// The caller's school, from their account (never from the request body).
const sid = (req) => req.user.schoolId

/* ══════════════════════════════════════════════════════
   SCHOOLS
══════════════════════════════════════════════════════ */
router.get('/schools', requireAuth, requireRole('superadmin'), ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM schools ORDER BY created_at DESC')
  res.json(rows.map(schoolToApi))
}))

router.get('/schools/:id', requireAuth, ah(async (req, res) => {
  const id = idParam(req.params.id, 'School')
  // Superadmin can read any school; everyone else only their own.
  if (req.user.role !== 'superadmin' && id !== sid(req)) throw new HttpError(404, 'School not found.')
  const { rows } = await query('SELECT * FROM schools WHERE id = $1', [id])
  if (!rows[0]) throw new HttpError(404, 'School not found.')
  res.json(schoolToApi(rows[0]))
}))

/* ══════════════════════════════════════════════════════
   SETTINGS (one per school)
══════════════════════════════════════════════════════ */
router.get('/settings', requireAuth, requireSchool, ah(async (req, res) => {
  res.json(settingsToApi(await ensureSettings(sid(req))))
}))

router.put('/settings', requireAuth, requireSchool, requireRole('admin', 'head'), ah(async (req, res) => {
  const b = req.body || {}
  const current = await ensureSettings(sid(req))

  // Only these fields can be changed; anything else in the body is ignored.
  const next = {
    school_name:    b.schoolName   !== undefined ? requiredStr(b.schoolName, 'School name') : current.school_name,
    circuit:        b.circuit      !== undefined ? str(b.circuit, 'Circuit') : current.circuit,
    district:       b.district     !== undefined ? str(b.district, 'District') : current.district,
    region:         b.region       !== undefined ? str(b.region, 'Region') : current.region,
    head_teacher:   b.headTeacher  !== undefined ? str(b.headTeacher, 'Head teacher') : current.head_teacher,
    academic_year:  b.academicYear !== undefined ? requiredStr(b.academicYear, 'Academic year', { max: 20 }) : current.academic_year,
    term:           b.term         !== undefined ? String(b.term) : current.term,
    next_term_date: b.nextTermDate !== undefined ? dateOrNull(b.nextTermDate, 'Next term date') : current.next_term_date,
  }
  if (!TERMS.includes(next.term)) throw new HttpError(400, 'Term must be 1, 2 or 3.')

  const row = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `UPDATE school_settings
          SET school_name = $2, circuit = $3, district = $4, region = $5, head_teacher = $6,
              academic_year = $7, term = $8, next_term_date = $9
        WHERE school_id = $1
        RETURNING *`,
      [sid(req), next.school_name, next.circuit, next.district, next.region,
       next.head_teacher, next.academic_year, next.term, next.next_term_date]
    )
    // Keep the platform's school record in step, so the superadmin sees the same name.
    await db.query(
      'UPDATE schools SET name = $2, circuit = $3, district = $4, region = $5 WHERE id = $1',
      [sid(req), next.school_name, next.circuit, next.district, next.region]
    )
    return rows[0]
  })
  res.json(settingsToApi(row))
}))

/* ══════════════════════════════════════════════════════
   STATS (dashboard)
══════════════════════════════════════════════════════ */
router.get('/stats', requireAuth, requireSchool, ah(async (req, res) => {
  const settings = await ensureSettings(sid(req))
  const { rows } = await query(
    `SELECT
       (SELECT count(*) FROM classes  WHERE school_id = $1)::int               AS total_classes,
       (SELECT count(*) FROM subjects WHERE school_id = $1)::int               AS subjects_count,
       (SELECT count(*) FROM students WHERE school_id = $1 AND is_active)::int AS total_students,
       (SELECT count(DISTINCT sc.student_id)
          FROM scores sc JOIN students st ON st.id = sc.student_id AND st.is_active
         WHERE sc.school_id = $1 AND sc.academic_year = $2 AND sc.term = $3)::int AS reports_generated`,
    [sid(req), settings.academic_year, settings.term]
  )
  const s = rows[0]
  res.json({
    totalClasses: s.total_classes,
    subjectsCount: s.subjects_count,
    totalStudents: s.total_students,
    // Students with at least one score this term (their report has data).
    reportsGenerated: s.reports_generated,
  })
}))

/* ══════════════════════════════════════════════════════
   CLASSES
══════════════════════════════════════════════════════ */
const CLASS_LIST_SQL = `
  SELECT c.*,
         (SELECT count(*) FROM students s WHERE s.class_id = c.id AND s.is_active)::int AS student_count,
         (SELECT string_agg(u.full_name, ', ' ORDER BY u.full_name)
            FROM users u
           WHERE u.class_id = c.id AND u.role = 'teacher' AND u.is_active)              AS teacher_name
    FROM classes c`

router.get('/classes', requireAuth, requireSchool, ah(async (req, res) => {
  const { rows } = await query(`${CLASS_LIST_SQL} WHERE c.school_id = $1 ORDER BY c.name`, [sid(req)])
  res.json(rows.map(classToApi))
}))

router.post('/classes', requireAuth, requireSchool, requireRole('admin'), ah(async (req, res) => {
  const { rows } = await query(
    'INSERT INTO classes (school_id, name, level) VALUES ($1, $2, $3) RETURNING *',
    [sid(req), requiredStr(req.body?.name, 'Class name'), str(req.body?.level, 'Level')]
  )
  res.status(201).json(classToApi(rows[0]))
}))

router.put('/classes/:id', requireAuth, requireSchool, requireRole('admin'), ah(async (req, res) => {
  const id = idParam(req.params.id, 'Class')
  const { rows } = await query(
    `UPDATE classes SET name = $3, level = $4 WHERE id = $1 AND school_id = $2 RETURNING id`,
    [id, sid(req), requiredStr(req.body?.name, 'Class name'), str(req.body?.level, 'Level')]
  )
  if (!rows[0]) throw new HttpError(404, 'Class not found.')
  const full = await query(`${CLASS_LIST_SQL} WHERE c.id = $1`, [id])
  res.json(classToApi(full.rows[0]))
}))

router.delete('/classes/:id', requireAuth, requireSchool, requireRole('admin'), ah(async (req, res) => {
  const id = idParam(req.params.id, 'Class')
  const { rows } = await query(
    'SELECT count(*)::int AS n FROM students WHERE class_id = $1 AND school_id = $2 AND is_active',
    [id, sid(req)]
  )
  if (rows[0].n > 0) {
    throw new HttpError(409, `This class still has ${rows[0].n} student(s). Move or remove them first.`)
  }
  const del = await query('DELETE FROM classes WHERE id = $1 AND school_id = $2', [id, sid(req)])
  if (!del.rowCount) throw new HttpError(404, 'Class not found.')
  res.json({ message: 'Class deleted.' })
}))

/* ══════════════════════════════════════════════════════
   SUBJECTS
══════════════════════════════════════════════════════ */
function subjectFields(b) {
  const order = b?.order === undefined || b?.order === '' ? 0 : Number(b.order)
  if (!Number.isInteger(order)) throw new HttpError(400, 'Order must be a whole number.')
  return [requiredStr(b?.name, 'Subject name'), str(b?.code, 'Code', { max: 20 }), order]
}

router.get('/subjects', requireAuth, requireSchool, ah(async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM subjects WHERE school_id = $1 ORDER BY sort_order, name',
    [sid(req)]
  )
  res.json(rows.map(subjectToApi))
}))

router.post('/subjects', requireAuth, requireSchool, requireRole('admin', 'head'), ah(async (req, res) => {
  const { rows } = await query(
    `INSERT INTO subjects (school_id, name, code, sort_order) VALUES ($1, $2, $3, $4) RETURNING *`,
    [sid(req), ...subjectFields(req.body)]
  )
  res.status(201).json(subjectToApi(rows[0]))
}))

router.put('/subjects/:id', requireAuth, requireSchool, requireRole('admin', 'head'), ah(async (req, res) => {
  const id = idParam(req.params.id, 'Subject')
  const { rows } = await query(
    `UPDATE subjects SET name = $3, code = $4, sort_order = $5
      WHERE id = $1 AND school_id = $2 RETURNING *`,
    [id, sid(req), ...subjectFields(req.body)]
  )
  if (!rows[0]) throw new HttpError(404, 'Subject not found.')
  res.json(subjectToApi(rows[0]))
}))

router.delete('/subjects/:id', requireAuth, requireSchool, requireRole('admin', 'head'), ah(async (req, res) => {
  const id = idParam(req.params.id, 'Subject')
  // Its scores are deleted with it (ON DELETE CASCADE).
  const del = await query('DELETE FROM subjects WHERE id = $1 AND school_id = $2', [id, sid(req)])
  if (!del.rowCount) throw new HttpError(404, 'Subject not found.')
  res.json({ message: 'Subject deleted.' })
}))

/* ══════════════════════════════════════════════════════
   MAX MARKS — raw maximum for each subject's class score
   API shape kept from before: { "<subjectId>": 30, ... }
══════════════════════════════════════════════════════ */
async function maxMarksMap(schoolId) {
  const { rows } = await query(
    'SELECT id, max_class_score FROM subjects WHERE school_id = $1 AND max_class_score IS NOT NULL',
    [schoolId]
  )
  return Object.fromEntries(rows.map((r) => [r.id, r.max_class_score]))
}

router.get('/max-marks', requireAuth, requireSchool, ah(async (req, res) => {
  res.json(await maxMarksMap(sid(req)))
}))

router.put('/max-marks', requireAuth, requireSchool, requireRole('admin', 'head'), ah(async (req, res) => {
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Send an object of { subjectId: maxMark }.')
  }
  const updates = []
  for (const [subjectId, raw] of Object.entries(body)) {
    if (!isUuid(subjectId)) throw new HttpError(400, 'Unknown subject in max marks.')
    // '' or null clears the value (the app then uses 100).
    const value = raw === '' || raw === null ? null : Number(raw)
    if (value !== null && (!Number.isFinite(value) || value <= 0 || value > 1000)) {
      throw new HttpError(400, 'Each max mark must be a number between 1 and 1000.')
    }
    updates.push([subjectId, value])
  }

  await withTransaction(async (db) => {
    for (const [subjectId, value] of updates) {
      const r = await db.query(
        'UPDATE subjects SET max_class_score = $3 WHERE id = $1 AND school_id = $2',
        [subjectId, sid(req), value]
      )
      if (!r.rowCount) throw new HttpError(400, 'Unknown subject in max marks.')
    }
  })
  res.json(await maxMarksMap(sid(req)))
}))

export default router
