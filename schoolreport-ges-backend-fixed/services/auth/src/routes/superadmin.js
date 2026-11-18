import { Router } from 'express'
import { query, withTransaction } from '../../../../shared/db.js'
import { ah, HttpError, isEmail, str, requiredStr, idParam } from '../../../../shared/http.js'
import { audit } from '../../../../shared/audit.js'
import { schoolToApi, currentAcademicYear } from '../../../school/src/models/index.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { USER_COLUMNS, hashPassword, makeUsername, userToApi } from '../models/User.js'
import { sendWelcomeEmail, emailConfigured } from '../utils/mailer.js'
import { generateTempPassword } from '../utils/password.js'

const router = Router()
// Mounted at: /api/superadmin
router.use(requireAuth, requireRole('superadmin'))

/* POST /api/superadmin/schools — create a school and its first admin in one transaction */
router.post('/schools', ah(async (req, res) => {
  const b = req.body || {}
  const schoolName  = requiredStr(b.schoolName, 'School name')
  const schoolEmail = requiredStr(b.schoolEmail, 'School email').toLowerCase()
  const adminName   = requiredStr(b.adminName, 'Admin name')
  const adminEmail  = requiredStr(b.adminEmail, 'Admin email').toLowerCase()
  const circuit     = str(b.circuit, 'Circuit')
  const district    = str(b.district, 'District')
  const region      = str(b.region, 'Region')
  if (!isEmail(schoolEmail)) throw new HttpError(400, 'School email is not a valid email address.')
  if (!isEmail(adminEmail))  throw new HttpError(400, 'Admin email is not a valid email address.')

  const [userExists, schoolExists] = await Promise.all([
    query('SELECT 1 FROM users WHERE email = $1', [adminEmail]),
    query('SELECT 1 FROM schools WHERE email = $1', [schoolEmail]),
  ])
  if (userExists.rowCount)   throw new HttpError(409, `A user with email "${adminEmail}" already exists.`)
  if (schoolExists.rowCount) throw new HttpError(409, `A school with email "${schoolEmail}" already exists.`)

  const tempPassword = generateTempPassword()
  const passwordHash = await hashPassword(tempPassword)

  let school, admin
  try {
    ({ school, admin } = await withTransaction(async (db) => {
      const s = await db.query(
        `INSERT INTO schools (name, email, circuit, district, region)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [schoolName, schoolEmail, circuit, district, region]
      )
      await db.query(
        `INSERT INTO school_settings (school_id, school_name, circuit, district, region, academic_year)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [s.rows[0].id, schoolName, circuit, district, region, currentAcademicYear()]
      )
      const u = await db.query(
        `INSERT INTO users (full_name, email, username, password_hash, role, school_id, must_change_password)
         VALUES ($1, $2, $3, $4, 'admin', $5, true)
         RETURNING ${USER_COLUMNS}`,
        [adminName, adminEmail, makeUsername(adminEmail), passwordHash, s.rows[0].id]
      )
      await audit(req, 'school.create', {
        db, schoolId: s.rows[0].id, targetType: 'school', targetId: s.rows[0].id,
        details: { name: schoolName, email: schoolEmail, adminEmail },
      })
      return { school: s.rows[0], admin: u.rows[0] }
    }))
  } catch (err) {
    // Someone created the same email between the check above and this insert.
    if (err.code === '23505') {
      throw new HttpError(409, err.constraint === 'schools_email_key'
        ? `A school with email "${schoolEmail}" already exists.`
        : `A user with email "${adminEmail}" already exists.`)
    }
    throw err
  }

  // Sent in the background so a slow mail server never blocks this response.
  sendWelcomeEmail({
    to: adminEmail, fullName: adminName, email: adminEmail,
    tempPassword, role: 'admin', schoolName,
  })

  res.status(201).json({
    message: `School "${schoolName}" created successfully.`,
    school: schoolToApi(school),
    admin: userToApi(admin),
    emailQueued: emailConfigured(),
    credentials: {
      loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`,
      email: adminEmail,
      password: tempPassword,
    },
  })
}))

/* GET /api/superadmin/schools */
router.get('/schools', ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM schools ORDER BY created_at DESC')
  res.json(rows.map(schoolToApi))
}))

/* PUT /api/superadmin/schools/:id/toggle — activate / deactivate a school */
router.put('/schools/:id/toggle', ah(async (req, res) => {
  const id = idParam(req.params.id, 'School')
  const { rows } = await query(
    'UPDATE schools SET is_active = NOT is_active WHERE id = $1 RETURNING *',
    [id]
  )
  if (!rows[0]) throw new HttpError(404, 'School not found.')
  await audit(req, rows[0].is_active ? 'school.activate' : 'school.deactivate', {
    schoolId: id, targetType: 'school', targetId: id, details: { name: rows[0].name },
  })
  res.json({
    message: `School ${rows[0].is_active ? 'activated' : 'deactivated'}.`,
    school: schoolToApi(rows[0]),
  })
}))

export default router
