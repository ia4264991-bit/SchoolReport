import { Router } from 'express'
import { query, withTransaction } from '../../../../shared/db.js'
import { ah, HttpError, isUuid, requiredStr, idParam, dateOrNull } from '../../../../shared/http.js'
import { audit, changes } from '../../../../shared/audit.js'
import { requireAuth, requireRole, requireSchool, assertClassAccess } from '../middleware/auth.js'
import { GENDERS, studentToApi } from '../models/Student.js'

const router = Router()
// Mounted at: /api/students
router.use(requireAuth, requireSchool)

const sid = (req) => req.user.schoolId
const MAX_BULK = 500

/** Validates a student body. For teachers the class is always their own. */
async function studentFields(req, b, { partial = false } = {}) {
  const out = {}
  if (!partial || b.fullName !== undefined) out.full_name = requiredStr(b.fullName, 'Full name')
  if (!partial || b.gender !== undefined) {
    if (!GENDERS.includes(b.gender)) throw new HttpError(400, 'Gender must be M or F.')
    out.gender = b.gender
  }
  if (!partial || b.dateOfBirth !== undefined) out.date_of_birth = dateOrNull(b.dateOfBirth, 'Date of birth')

  if (req.user.role === 'teacher') {
    if (!req.user.classId) throw new HttpError(403, 'You have no class assigned. Ask your admin.')
    if (b.classId !== undefined && b.classId !== '' && b.classId !== req.user.classId) {
      throw new HttpError(403, 'You can only manage students in your assigned class.')
    }
    if (!partial) out.class_id = req.user.classId
  } else if (!partial || b.classId !== undefined) {
    if (!isUuid(b.classId)) throw new HttpError(400, 'Please choose a class.')
    await assertClassAccess(req, b.classId)
    out.class_id = b.classId
  }
  return out
}

/** Loads a student of the caller's school (teachers: only their class) or answers 404. */
async function findStudent(req) {
  const id = idParam(req.params.id, 'Student')
  const { rows } = await query(
    'SELECT * FROM students WHERE id = $1 AND school_id = $2 AND is_active',
    [id, sid(req)]
  )
  const s = rows[0]
  if (!s || (req.user.role === 'teacher' && s.class_id !== req.user.classId)) {
    throw new HttpError(404, 'Student not found.')
  }
  return s
}

/* GET /api/students?classId=xxx */
router.get('/', ah(async (req, res) => {
  if (req.user.role === 'student') throw new HttpError(403, 'Student accounts cannot view the class roster.')

  let classId = req.query.classId || null
  if (req.user.role === 'teacher') {
    if (!req.user.classId) return res.json([]) // no class assigned → nothing to show
    classId = req.user.classId
  } else if (classId) {
    await assertClassAccess(req, classId)
  }

  const { rows } = classId
    ? await query(
        'SELECT * FROM students WHERE school_id = $1 AND class_id = $2 AND is_active ORDER BY full_name',
        [sid(req), classId])
    : await query(
        'SELECT * FROM students WHERE school_id = $1 AND is_active ORDER BY full_name',
        [sid(req)])
  res.json(rows.map(studentToApi))
}))

/* GET /api/students/:id */
router.get('/:id', ah(async (req, res) => {
  if (req.user.role === 'student') throw new HttpError(403, 'Student accounts cannot view student records.')
  res.json(studentToApi(await findStudent(req)))
}))

/* POST /api/students */
router.post('/', requireRole('admin', 'head', 'teacher'), ah(async (req, res) => {
  const f = await studentFields(req, req.body || {})
  const { rows } = await query(
    `INSERT INTO students (school_id, class_id, full_name, gender, date_of_birth)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [sid(req), f.class_id, f.full_name, f.gender, f.date_of_birth]
  )
  await audit(req, 'student.create', { targetType: 'student', targetId: rows[0].id, details: { name: f.full_name, classId: f.class_id } })
  res.status(201).json(studentToApi(rows[0]))
}))

/* POST /api/students/bulk  { students: [...] } */
router.post('/bulk', requireRole('admin', 'head'), ah(async (req, res) => {
  const list = req.body?.students
  if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, 'Send a non-empty "students" list.')
  if (list.length > MAX_BULK) throw new HttpError(400, `At most ${MAX_BULK} students per upload.`)

  const prepared = []
  for (const [i, s] of list.entries()) {
    try {
      prepared.push(await studentFields(req, s || {}))
    } catch (err) {
      if (err instanceof HttpError) throw new HttpError(err.status, `Row ${i + 1}: ${err.message}`)
      throw err
    }
  }

  const created = await withTransaction(async (db) => {
    const out = []
    for (const f of prepared) {
      const { rows } = await db.query(
        `INSERT INTO students (school_id, class_id, full_name, gender, date_of_birth)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [sid(req), f.class_id, f.full_name, f.gender, f.date_of_birth]
      )
      out.push(studentToApi(rows[0]))
    }
    await audit(req, 'student.bulk_create', { db, details: { count: out.length } })
    return out
  })
  res.status(201).json(created)
}))

/* PUT /api/students/:id */
router.put('/:id', requireRole('admin', 'head', 'teacher'), ah(async (req, res) => {
  const student = await findStudent(req)
  const fields = await studentFields(req, req.body || {}, { partial: true })
  const cols = Object.keys(fields)
  if (!cols.length) return res.json(studentToApi(student))

  const { rows } = await query(
    `UPDATE students SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}
      WHERE id = $1 AND school_id = $2 RETURNING *`,
    [student.id, sid(req), ...Object.values(fields)]
  )
  const diff = changes(student, fields)
  if (Object.keys(diff).length) await audit(req, 'student.update', { targetType: 'student', targetId: student.id, details: diff })
  res.json(studentToApi(rows[0]))
}))

/* DELETE /api/students/:id — soft delete (keeps their past scores) */
router.delete('/:id', requireRole('admin', 'head'), ah(async (req, res) => {
  const student = await findStudent(req)
  await query('UPDATE students SET is_active = false WHERE id = $1', [student.id])
  // A removed student's own login (if any) stops working too.
  const logins = await query(
    'UPDATE users SET is_active = false WHERE student_id = $1 AND school_id = $2 AND is_active RETURNING id',
    [student.id, sid(req)]
  )
  await audit(req, 'student.remove', {
    targetType: 'student', targetId: student.id,
    details: { name: student.full_name, loginsDeactivated: logins.rowCount },
  })
  res.json({ message: 'Student removed.' })
}))

export default router
