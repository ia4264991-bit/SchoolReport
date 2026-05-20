import { Router } from 'express'
import User from '../models/User.js'
import { School } from '../../../school/src/models/index.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { sendWelcomeEmail } from '../utils/mailer.js'
import { generateTempPassword } from '../utils/password.js'

const router = Router()
// Mounted at: /api/superadmin

/* ═══════════════════════════════════════════════════════════════
   POST /api/superadmin/schools
   Creates a school + first admin user in one atomic flow.
   Credentials are ALWAYS returned in the response regardless
   of whether the email was delivered.
═══════════════════════════════════════════════════════════════ */
router.post('/schools', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { schoolName, schoolEmail, adminName, adminEmail, circuit, district, region } = req.body

    if (!schoolName || !schoolEmail || !adminName || !adminEmail) {
      return res.status(400).json({
        message: 'schoolName, schoolEmail, adminName and adminEmail are all required.',
      })
    }

    // Check admin email not already taken
    const userExists = await User.findOne({ email: adminEmail.toLowerCase() })
    if (userExists) {
      return res.status(409).json({ message: 'A user with that admin email already exists.' })
    }

    // Check school email not already taken
    const schoolExists = await School.findOne({ email: schoolEmail.toLowerCase() })
    if (schoolExists) {
      return res.status(409).json({ message: 'A school with that email already exists.' })
    }

    // Create school
    const school = await School.create({
      name:     schoolName,
      email:    schoolEmail.toLowerCase(),
      circuit:  circuit  || '',
      district: district || '',
      region:   region   || '',
    })

    // Generate credentials
    const tempPassword = generateTempPassword()

    // Build a unique username: email prefix + last 6 chars of school _id
    const emailPrefix = adminEmail.toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '')
    const uniqueSuffix = school._id.toString().slice(-6)
    const username = `${emailPrefix}_${uniqueSuffix}`

    // Create admin user
    const admin = await User.create({
      fullName:           adminName,
      email:              adminEmail.toLowerCase(),
      username,
      password:           tempPassword,
      role:               'admin',
      schoolId:           school._id,
      mustChangePassword: true,
    })

    // Try email — non-fatal, credentials always returned in response
    const emailSent = await sendWelcomeEmail({
      to:          adminEmail,
      fullName:    adminName,
      email:       adminEmail,
      tempPassword,
      role:        'admin',
      schoolName,
    })

    return res.status(201).json({
      message: `School "${schoolName}" created successfully.`,
      emailSent,
      school,
      admin,
      credentials: {
        loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`,
        email:     adminEmail,
        password:  tempPassword,
        note: emailSent
          ? 'Credentials also emailed to the admin.'
          : '⚠️ Email delivery failed — share these credentials manually with the admin.',
      },
    })
  } catch (err) {
    console.error('[SuperAdmin] Create school error:', err.message)

    // Friendly messages for common MongoDB errors
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field'
      return res.status(409).json({
        message: `A record with that ${field} already exists. Please use different values.`,
      })
    }

    return res.status(400).json({ message: err.message })
  }
})

/* ═══════════════════════════════════════════════════════════════
   GET /api/superadmin/schools
═══════════════════════════════════════════════════════════════ */
router.get('/schools', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const schools = await School.find().sort({ createdAt: -1 })
    res.json(schools)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ═══════════════════════════════════════════════════════════════
   PUT /api/superadmin/schools/:id/toggle
═══════════════════════════════════════════════════════════════ */
router.put('/schools/:id/toggle', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const school = await School.findById(req.params.id)
    if (!school) return res.status(404).json({ message: 'School not found.' })
    school.isActive = !school.isActive
    await school.save()
    res.json({
      message: `School ${school.isActive ? 'activated' : 'deactivated'}.`,
      school,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router

