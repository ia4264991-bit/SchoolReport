import { Router } from 'express'
import mongoose from 'mongoose'
import User from '../models/User.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { sendWelcomeEmail } from '../utils/mailer.js'
import { generateTempPassword } from '../utils/password.js'

const router = Router()

// Mounted at: /api/superadmin
// All paths below are RELATIVE — no /superadmin/* prefix here.

// Lazy-load or reuse the School model (shared MongoDB URI means one connection)
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

/* ─────────────────────────────────────────────────────────
   POST /api/superadmin/schools
   Create school + first admin user in one shot
───────────────────────────────────────────────────────── */
router.post('/schools', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { schoolName, schoolEmail, adminName, adminEmail, circuit, district, region } = req.body
    if (!schoolName || !schoolEmail || !adminName || !adminEmail) {
      return res.status(400).json({ message: 'schoolName, schoolEmail, adminName and adminEmail are required.' })
    }

    const emailExists = await User.findOne({ email: adminEmail.toLowerCase() })
    if (emailExists) return res.status(409).json({ message: 'A user with that admin email already exists.' })

    const School = getSchoolModel()
    const schoolEmailLower = schoolEmail.toLowerCase()
    const schoolExists = await School.findOne({ email: schoolEmailLower })
    if (schoolExists) return res.status(409).json({ message: 'A school with that email already exists.' })

    const school = await School.create({
      name: schoolName, email: schoolEmailLower, circuit, district, region
    })

    const tempPassword = generateTempPassword()
    const admin = await User.create({
      fullName: adminName,
      email: adminEmail.toLowerCase(),
      username: adminEmail.toLowerCase().split('@')[0],
      password: tempPassword,
      role: 'admin',
      schoolId: school._id,
      mustChangePassword: true,
    })

    sendWelcomeEmail({ to: adminEmail, fullName: adminName, email: adminEmail, tempPassword, role: 'admin', schoolName })

    res.status(201).json({
      message: `School "${schoolName}" created. Admin credentials sent to ${adminEmail}.`,
      school,
      admin,
    })
  } catch (err) {
    console.error('[SuperAdmin] Create school:', err)
    res.status(400).json({ message: err.message })
  }
})

/* ─────────────────────────────────────────────────────────
   GET /api/superadmin/schools
   List all schools
───────────────────────────────────────────────────────── */
router.get('/schools', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const School = getSchoolModel()
    const schools = await School.find().sort({ createdAt: -1 })
    res.json(schools)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─────────────────────────────────────────────────────────
   PUT /api/superadmin/schools/:id/toggle
   Activate / deactivate a school
───────────────────────────────────────────────────────── */
router.put('/schools/:id/toggle', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const School = getSchoolModel()
    const school = await School.findById(req.params.id)
    if (!school) return res.status(404).json({ message: 'School not found.' })
    school.isActive = !school.isActive
    await school.save()
    res.json({ message: `School ${school.isActive ? 'activated' : 'deactivated'}.`, school })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
