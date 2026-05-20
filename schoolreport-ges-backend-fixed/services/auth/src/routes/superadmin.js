import { Router } from 'express'
import mongoose from 'mongoose'
import User from '../models/User.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { sendWelcomeEmail } from '../utils/mailer.js'
import { generateTempPassword } from '../utils/password.js'

const router = Router()
// Mounted at: /api/superadmin

function getSchoolModel() {
  return mongoose.models.School || mongoose.model('School', new mongoose.Schema({
    name:         { type: String, required: true },
    email:        { type: String, required: true, unique: true },
    circuit:      { type: String, default: '' },
    district:     { type: String, default: '' },
    region:       { type: String, default: '' },
    academicYear: { type: String, default: '2024/2025' },
    term:         { type: String, default: '1' },
    isActive:     { type: Boolean, default: true },
  }, { timestamps: true }))
}

/* POST /api/superadmin/schools */
router.post('/schools', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { schoolName, schoolEmail, adminName, adminEmail, circuit, district, region } = req.body
    if (!schoolName || !schoolEmail || !adminName || !adminEmail)
      return res.status(400).json({ message: 'schoolName, schoolEmail, adminName and adminEmail are required.' })

    const emailExists = await User.findOne({ email: adminEmail.toLowerCase() })
    if (emailExists) return res.status(409).json({ message: 'A user with that admin email already exists.' })

    const School = getSchoolModel()
    const schoolExists = await School.findOne({ email: schoolEmail.toLowerCase() })
    if (schoolExists) return res.status(409).json({ message: 'A school with that email already exists.' })

    const school = await School.create({
      name: schoolName, email: schoolEmail.toLowerCase(), circuit, district, region,
    })

    const tempPassword = generateTempPassword()
    const admin = await User.create({
      fullName:           adminName,
      email:              adminEmail.toLowerCase(),
      username:           adminEmail.toLowerCase().split('@')[0],
      password:           tempPassword,
      role:               'admin',
      schoolId:           school._id,
      mustChangePassword: true,
    })

    // Try to email — non-fatal; credentials are ALWAYS in response
    const emailSent = await sendWelcomeEmail({
      to: adminEmail, fullName: adminName, email: adminEmail,
      tempPassword, role: 'admin', schoolName,
    })

    res.status(201).json({
      message:   `School "${schoolName}" created successfully.`,
      emailSent,
      school,
      admin,
      // Credentials always returned so superadmin can share manually if email fails
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
    console.error('[SuperAdmin] Create school:', err)
    res.status(400).json({ message: err.message })
  }
})

/* GET /api/superadmin/schools */
router.get('/schools', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const School = getSchoolModel()
    const schools = await School.find().sort({ createdAt: -1 })
    res.json(schools)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* PUT /api/superadmin/schools/:id/toggle */
router.put('/schools/:id/toggle', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const School = getSchoolModel()
    const school = await School.findById(req.params.id)
    if (!school) return res.status(404).json({ message: 'School not found.' })
    school.isActive = !school.isActive
    await school.save()
    res.json({ message: `School ${school.isActive ? 'activated' : 'deactivated'}.`, school })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

export default router
