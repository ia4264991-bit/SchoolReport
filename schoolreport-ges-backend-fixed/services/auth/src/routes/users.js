import { Router } from 'express'
import { query } from '../../../../shared/db.js'
import { ah, HttpError, isEmail, isUuid, str, requiredStr, idParam } from '../../../../shared/http.js'
import { audit, changes } from '../../../../shared/audit.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { USER_COLUMNS, SCHOOL_ROLES, hashPassword, makeUsername, userToApi } from '../models/User.js'
import { sendWelcomeEmail, sendAdminResetEmail } from '../utils/mailer.js'
import { generateTempPassword } from '../utils/password.js'

const router = Router()
// Mounted at: /api/users

function checkRole(role) {
  if (!SCHOOL_ROLES.includes(role)) {
    throw new HttpError(400, `Role must be one of: ${SCHOOL_ROLES.join(', ')}.`)
  }
  return role
}

/** '' / null → null; otherwise it must be a class in the admin's own school. */
async function checkClassId(classId, schoolId) {
  if (classId === undefined || classId === null || classId === '') return null
  if (!isUuid(classId)) throw new HttpError(400, 'Assigned class not found.')
  const { rowCount } = await query('SELECT 1 FROM classes WHERE id = $1 AND school_id = $2', [classId, schoolId])
  if (!rowCount) throw new HttpError(400, 'Assigned class not found.')
  return classId
}

/**
 * A student login must point at one active student record of the admin's school.
 * Returns that student's row (its class becomes the login's class).
 */
async function checkStudentId(studentId, schoolId) {
  if (!isUuid(studentId)) throw new HttpError(400, 'Choose the student this login is for.')
  const { rows } = await query(
    'SELECT id, class_id, full_name FROM students WHERE id = $1 AND school_id = $2 AND is_active',
    [studentId, schoolId]
  )
  if (!rows[0]) throw new HttpError(400, 'Student not found in your school.')
  return rows[0]
}

/** Friendly messages for the unique indexes on users. */
function conflict(err) {
  if (err.code !== '23505') return err
  if (String(err.constraint).includes('student')) return new HttpError(409, 'This student already has a login.')
  return new HttpError(409, 'A user with this email already exists.')
}

async function schoolName(schoolId) {
  const { rows } = await query('SELECT school_name FROM school_settings WHERE school_id = $1', [schoolId])
  return rows[0]?.school_name || 'Your School'
}

/** Loads a user of the admin's school or answers 404. */
async function findSchoolUser(req) {
  const id = idParam(req.params.id, 'User')
  const { rows } = await query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND school_id = $2`,
    [id, req.user.schoolId]
  )
  if (!rows[0]) throw new HttpError(404, 'User not found in your school.')
  return rows[0]
}

/* GET /api/users — admin: own school; superadmin: everyone */
router.get('/', requireAuth, requireRole('admin', 'superadmin'), ah(async (req, res) => {
  const { rows } = req.user.role === 'superadmin'
    ? await query(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at DESC`)
    : await query(`SELECT ${USER_COLUMNS} FROM users WHERE school_id = $1 ORDER BY created_at DESC`, [req.user.schoolId])
  res.json(rows.map(userToApi))
}))

/* POST /api/users — create a staff/student login with an emailed temporary password */
router.post('/', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const b = req.body || {}
  const fullName = requiredStr(b.fullName, 'Full name')
  const email = requiredStr(b.email, 'Email').toLowerCase()
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.')
  const role = checkRole(b.role)
  let classId = await checkClassId(b.classId, req.user.schoolId)
  let studentId = null
  if (role === 'student') {
    const student = await checkStudentId(b.studentId, req.user.schoolId)
    studentId = student.id
    classId = student.class_id // a student login follows its student's class
  } else if (b.studentId) {
    throw new HttpError(400, 'Only student logins can be linked to a student.')
  }
  const notes = str(b.notes, 'Notes', { max: 1000 })

  const tempPassword = generateTempPassword()
  let user
  try {
    const { rows } = await query(
      `INSERT INTO users (full_name, email, username, password_hash, role, school_id, class_id, student_id, notes, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       RETURNING ${USER_COLUMNS}`,
      [fullName, email, makeUsername(email), await hashPassword(tempPassword), role, req.user.schoolId, classId, studentId, notes]
    )
    user = rows[0]
  } catch (err) {
    throw conflict(err)
  }
  await audit(req, 'user.create', { targetType: 'user', targetId: user.id, details: { email, role, classId, studentId } })

  sendWelcomeEmail({
    to: email, fullName, email, tempPassword, role,
    schoolName: await schoolName(req.user.schoolId),
  })

  res.status(201).json({
    user: userToApi(user),
    credentials: { email, password: tempPassword },
    message: 'User created successfully.',
  })
}))

/* PUT /api/users/:id */
router.put('/:id', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const target = await findSchoolUser(req)
  const b = req.body || {}
  const isSelf = target.id === req.user.id

  const fields = {}
  if (b.fullName !== undefined) fields.full_name = requiredStr(b.fullName, 'Full name')
  if (b.email !== undefined) {
    const email = requiredStr(b.email, 'Email').toLowerCase()
    if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.')
    fields.email = email
  }
  if (b.role !== undefined && b.role !== target.role) {
    if (isSelf) throw new HttpError(400, 'You cannot change your own role.')
    fields.role = checkRole(b.role)
  }
  if (b.classId !== undefined) fields.class_id = await checkClassId(b.classId, req.user.schoolId)

  // Student link: required for student logins, cleared for every other role.
  const finalRole = fields.role || target.role
  if (finalRole === 'student') {
    const wanted = b.studentId !== undefined ? b.studentId : target.student_id
    const student = await checkStudentId(wanted, req.user.schoolId)
    if (student.id !== target.student_id) fields.student_id = student.id
    fields.class_id = student.class_id
  } else {
    if (b.studentId) throw new HttpError(400, 'Only student logins can be linked to a student.')
    if (target.student_id) fields.student_id = null
  }
  if (b.notes !== undefined) fields.notes = str(b.notes, 'Notes', { max: 1000 })
  if (typeof b.isActive === 'boolean' && b.isActive !== target.is_active) {
    if (isSelf) throw new HttpError(400, 'You cannot deactivate your own account.')
    fields.is_active = b.isActive
  }

  const cols = Object.keys(fields)
  if (!cols.length) return res.json(userToApi(target))

  try {
    const { rows } = await query(
      `UPDATE users SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}
        WHERE id = $1 AND school_id = $2
        RETURNING ${USER_COLUMNS}`,
      [target.id, req.user.schoolId, ...Object.values(fields)]
    )
    const diff = changes(target, fields)
    if (Object.keys(diff).length) {
      await audit(req, 'user.update', { targetType: 'user', targetId: target.id, details: diff })
    }
    res.json(userToApi(rows[0]))
  } catch (err) {
    throw conflict(err)
  }
}))

/* DELETE /api/users/:id — deactivates (keeps the record) */
router.delete('/:id', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const target = await findSchoolUser(req)
  if (target.id === req.user.id) throw new HttpError(400, 'You cannot deactivate your own account.')
  await query('UPDATE users SET is_active = false WHERE id = $1', [target.id])
  await audit(req, 'user.deactivate', { targetType: 'user', targetId: target.id, details: { email: target.email } })
  res.json({ message: 'User deactivated.' })
}))

/* POST /api/users/:id/reset-password — admin sets a new temporary password */
router.post('/:id/reset-password', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const target = await findSchoolUser(req)
  const newPassword = generateTempPassword()
  // token_version + 1 signs the user out of every session.
  await query(
    `UPDATE users SET password_hash = $2, must_change_password = true, token_version = token_version + 1,
            otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0
      WHERE id = $1`,
    [target.id, await hashPassword(newPassword)]
  )
  await audit(req, 'user.reset_password', { targetType: 'user', targetId: target.id, details: { email: target.email } })

  sendAdminResetEmail({
    to: target.email, fullName: target.full_name,
    newPassword, schoolName: await schoolName(req.user.schoolId),
  })

  res.json({
    message: `Password reset for ${target.full_name}. New credentials sent to ${target.email}.`,
    credentials: { email: target.email, password: newPassword },
  })
}))

export default router
