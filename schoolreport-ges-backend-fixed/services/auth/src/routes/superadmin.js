import { Router } from 'express'
import User from '../models/User.js'
import { School } from '../../../school/src/models/index.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { sendWelcomeEmail } from '../utils/mailer.js'
import { generateTempPassword } from '../utils/password.js'

const router = Router()
// Mounted at: /api/superadmin

/* ═══════════════════════════════════════════════════════
   POST /api/superadmin/schools
═══════════════════════════════════════════════════════ */
router.post('/schools', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { schoolName, schoolEmail, adminName, adminEmail, circuit, district, region } = req.body

  // 1. Validate
  if (!schoolName || !schoolEmail || !adminName || !adminEmail) {
    return res.status(400).json({
      message: 'schoolName, schoolEmail, adminName and adminEmail are all required.',
    })
  }

  // 2. Duplicate checks
  try {
    const [userExists, schoolExists] = await Promise.all([
      User.findOne({ email: adminEmail.toLowerCase() }),
      School.findOne({ email: schoolEmail.toLowerCase() }),
    ])
    if (userExists) {
      return res.status(409).json({ message: `A user with email "${adminEmail}" already exists.` })
    }
    if (schoolExists) {
      return res.status(409).json({ message: `A school with email "${schoolEmail}" already exists.` })
    }
  } catch (err) {
    console.error('[SuperAdmin] Duplicate-check error:', err.message)
    return res.status(500).json({ message: 'Database lookup failed: ' + err.message })
  }

  // 3. Create school
  let school
  try {
    school = await School.create({
      name:     schoolName,
      email:    schoolEmail.toLowerCase(),
      circuit:  circuit  || '',
      district: district || '',
      region:   region   || '',
    })
  } catch (err) {
    console.error('[SuperAdmin] School.create error:', err.message)
    if (err.code === 11000) {
      return res.status(409).json({ message: 'A school with that email already exists.' })
    }
    return res.status(500).json({ message: 'Failed to create school: ' + err.message })
  }

  // 4. Create admin user
  let admin
  const tempPassword = generateTempPassword()
  const emailPrefix  = adminEmail.toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '') || 'admin'
  const username     = `${emailPrefix}_${school._id.toString().slice(-6)}`

  try {
    admin = await User.create({
      fullName:           adminName,
      email:              adminEmail.toLowerCase(),
      username,
      password:           tempPassword,
      role:               'admin',
      schoolId:           school._id,
      mustChangePassword: true,
    })
  } catch (err) {
    // Rollback school if user creation fails
    console.error('[SuperAdmin] User.create error:', err.message)
    await School.findByIdAndDelete(school._id).catch(() => {})
    if (err.code === 11000) {
      return res.status(409).json({ message: 'A user with that email already exists.' })
    }
    return res.status(500).json({ message: 'Failed to create admin user: ' + err.message })
  }

  // 5. Fire welcome email in background — does NOT block the response
  sendWelcomeEmail({
    to: adminEmail, fullName: adminName, email: adminEmail,
    tempPassword, role: 'admin', schoolName,
  })

  // 6. Respond immediately with credentials
  return res.status(201).json({
    message: `School "${schoolName}" created successfully.`,
    school,
    admin,
    credentials: {
      loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`,
      email:     adminEmail,
      password:  tempPassword,
      note:      'A welcome email with these credentials has been sent to the admin.',
    },
  })
})

/* ═══════════════════════════════════════════════════════
   GET /api/superadmin/schools
═══════════════════════════════════════════════════════ */
router.get('/schools', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const schools = await School.find().sort({ createdAt: -1 })
    res.json(schools)
  } catch (err) {
    console.error('[SuperAdmin] GET schools error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

/* ═══════════════════════════════════════════════════════
   PUT /api/superadmin/schools/:id/toggle
═══════════════════════════════════════════════════════ */
router.put('/schools/:id/toggle', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const school = await School.findById(req.params.id)
    if (!school) return res.status(404).json({ message: 'School not found.' })
    school.isActive = !school.isActive
    await school.save()
    res.json({ message: `School ${school.isActive ? 'activated' : 'deactivated'}.`, school })
  } catch (err) {
    console.error('[SuperAdmin] Toggle error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

export default router
