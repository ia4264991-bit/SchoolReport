import { Router } from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import User from '../models/User.js'
import { requireAuth, requireRole, requireSameSchool } from '../middleware/auth.js'
import { sendWelcomeEmail, sendPasswordResetEmail, sendAdminResetEmail } from '../utils/mailer.js'
import { generateTempPassword, generateResetToken } from '../utils/password.js'

const router = Router()

/* ════════════════════════════════════════════════════════
   POST /auth/login
   Public — login by email + password (replaces username login)
════════════════════════════════════════════════════════ */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' })
    }
    const user = await User.findOne({ email: email.toLowerCase(), isActive: true })
    if (!user) return res.status(401).json({ message: 'Invalid email or password.' })

    const match = await user.comparePassword(password)
    if (!match) return res.status(401).json({ message: 'Invalid email or password.' })

    const token = jwt.sign(
      {
        id:       user._id,
        email:    user.email,
        role:     user.role,
        schoolId: user.schoolId?.toString() || null,
        fullName: user.fullName,
        classId:  user.classId || null,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )

    res.json({ token, user, mustChangePassword: user.mustChangePassword })
  } catch (err) {
    console.error('[Auth] Login:', err)
    res.status(500).json({ message: 'Server error during login.' })
  }
})

/* ════════════════════════════════════════════════════════
   GET /auth/me
   Authenticated — returns current user profile
════════════════════════════════════════════════════════ */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })
    res.json(user)
  } catch { res.status(500).json({ message: 'Server error.' }) }
})

/* ════════════════════════════════════════════════════════
   POST /auth/change-password
   Authenticated — first-login or voluntary password change
════════════════════════════════════════════════════════ */
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new passwords are required.' })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' })
    }
    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })

    const match = await user.comparePassword(currentPassword)
    if (!match) return res.status(400).json({ message: 'Current password is incorrect.' })

    user.password = newPassword
    user.mustChangePassword = false
    await user.save()
    res.json({ message: 'Password changed successfully.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ════════════════════════════════════════════════════════
   POST /auth/forgot-password
   Public — sends reset link to email
════════════════════════════════════════════════════════ */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'Email is required.' })

    const user = await User.findOne({ email: email.toLowerCase(), isActive: true })
    // Always return 200 — never reveal whether email exists (security)
    if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' })

    const token = generateResetToken()
    user.resetToken = token
    user.resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    await user.save()

    await sendPasswordResetEmail({ to: user.email, fullName: user.fullName, resetToken: token })
    res.json({ message: 'If that email exists, a reset link has been sent.' })
  } catch (err) {
    console.error('[Auth] Forgot-password:', err)
    res.status(500).json({ message: 'Server error.' })
  }
})

/* ════════════════════════════════════════════════════════
   POST /auth/reset-password
   Public — validates reset token and sets new password
════════════════════════════════════════════════════════ */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body
    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Token and new password are required.' })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' })
    }
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: new Date() },
      isActive: true,
    })
    if (!user) {
      return res.status(400).json({ message: 'Reset link is invalid or has expired.' })
    }

    user.password = newPassword
    user.mustChangePassword = false
    user.resetToken = null
    user.resetTokenExpiry = null
    await user.save()

    res.json({ message: 'Password reset successfully. You can now log in.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ════════════════════════════════════════════════════════
   SUPER ADMIN — POST /superadmin/schools
   Creates a school + its first admin user in one shot
════════════════════════════════════════════════════════ */
router.post('/superadmin/schools', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { schoolName, schoolEmail, adminName, adminEmail, circuit, district, region } = req.body
    if (!schoolName || !schoolEmail || !adminName || !adminEmail) {
      return res.status(400).json({ message: 'schoolName, schoolEmail, adminName and adminEmail are required.' })
    }

    // Check admin email not already taken
    const emailExists = await User.findOne({ email: adminEmail.toLowerCase() })
    if (emailExists) return res.status(409).json({ message: 'A user with that admin email already exists.' })

    // Create school document in School model (imported dynamically to avoid circular deps)
    // We store school data in the School collection inside the school service's DB.
    // Since auth service shares the same MONGO_URI, we define a minimal School schema here.
    const School = mongoose.models.School || mongoose.model('School', new mongoose.Schema({
      name:         { type: String, required: true },
      email:        { type: String, required: true, unique: true },
      circuit:      { type: String, default: '' },
      district:     { type: String, default: '' },
      region:       { type: String, default: '' },
      academicYear: { type: String, default: '2024/2025' },
      term:         { type: String, default: '1' },
      isActive:     { type: Boolean, default: true },
    }, { timestamps: true }))

    const schoolEmailLower = schoolEmail.toLowerCase()
    const schoolExists = await School.findOne({ email: schoolEmailLower })
    if (schoolExists) return res.status(409).json({ message: 'A school with that email already exists.' })

    const school = await School.create({
      name: schoolName, email: schoolEmailLower, circuit, district, region
    })

    // Generate and create admin user
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

    // Send credentials email (non-blocking)
    sendWelcomeEmail({
      to: adminEmail,
      fullName: adminName,
      email: adminEmail,
      tempPassword,
      role: 'admin',
      schoolName,
    })

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

/* ════════════════════════════════════════════════════════
   SUPER ADMIN — GET /superadmin/schools
   List all schools
════════════════════════════════════════════════════════ */
router.get('/superadmin/schools', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const School = mongoose.models.School
    if (!School) return res.json([])
    const schools = await School.find().sort({ createdAt: -1 })
    res.json(schools)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ════════════════════════════════════════════════════════
   SUPER ADMIN — PUT /superadmin/schools/:id/toggle
   Activate / deactivate a school
════════════════════════════════════════════════════════ */
router.put('/superadmin/schools/:id/toggle', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const School = mongoose.models.School
    const school = await School.findById(req.params.id)
    if (!school) return res.status(404).json({ message: 'School not found.' })
    school.isActive = !school.isActive
    await school.save()
    res.json({ message: `School ${school.isActive ? 'activated' : 'deactivated'}.`, school })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ════════════════════════════════════════════════════════
   GET /users
   Admin — lists users scoped to their own school only
════════════════════════════════════════════════════════ */
router.get('/users', requireAuth, requireRole('admin', 'superadmin'), async (req, res) => {
  try {
    const filter = req.user.role === 'superadmin'
      ? {}
      : { schoolId: req.user.schoolId }
    const users = await User.find(filter).sort({ createdAt: -1 })
    res.json(users)
  } catch { res.status(500).json({ message: 'Server error.' }) }
})

/* ════════════════════════════════════════════════════════
   POST /users
   Admin — creates user, auto-generates password, sends email
════════════════════════════════════════════════════════ */
router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { fullName, email, role, classId, notes, schoolName } = req.body
    if (!fullName || !email || !role) {
      return res.status(400).json({ message: 'fullName, email and role are required.' })
    }
    const validRoles = ['admin', 'head', 'teacher', 'student']
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: `Invalid role. Must be one of: ${validRoles.join(', ')}` })
    }

    const exists = await User.findOne({ email: email.toLowerCase() })
    if (exists) return res.status(409).json({ message: 'A user with this email already exists.' })

    const tempPassword = generateTempPassword()
    const user = await User.create({
      fullName,
      email: email.toLowerCase(),
      username: email.toLowerCase().split('@')[0] + '_' + Date.now().toString().slice(-4),
      password: tempPassword,
      role,
      schoolId: req.user.schoolId,
      classId: classId || null,
      notes: notes || '',
      mustChangePassword: true,
    })

    // Send credentials email (non-blocking — won't fail the request)
    sendWelcomeEmail({
      to: email,
      fullName,
      email,
      tempPassword,
      role,
      schoolName: schoolName || 'Your School',
    })

    res.status(201).json({ user, message: 'User created. Credentials sent to email.' })
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

/* ════════════════════════════════════════════════════════
   PUT /users/:id
   Admin — update user (same school only)
════════════════════════════════════════════════════════ */
router.put('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { fullName, email, role, classId, notes, isActive } = req.body
    const user = await User.findOne({ _id: req.params.id, schoolId: req.user.schoolId })
    if (!user) return res.status(404).json({ message: 'User not found in your school.' })

    if (fullName) user.fullName = fullName
    if (email)    user.email    = email.toLowerCase()
    if (role)     user.role     = role
    if (classId !== undefined) user.classId = classId || null
    if (notes !== undefined)   user.notes = notes
    if (typeof isActive === 'boolean') user.isActive = isActive

    await user.save()
    res.json(user)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

/* ════════════════════════════════════════════════════════
   DELETE /users/:id
   Admin — soft-delete (deactivate) user in same school
════════════════════════════════════════════════════════ */
router.delete('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your own account.' })
    }
    const user = await User.findOne({ _id: req.params.id, schoolId: req.user.schoolId })
    if (!user) return res.status(404).json({ message: 'User not found in your school.' })
    user.isActive = false
    await user.save()
    res.json({ message: 'User deactivated.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ════════════════════════════════════════════════════════
   POST /users/:id/reset-password
   Admin — force-reset a user's password and email new credentials
════════════════════════════════════════════════════════ */
router.post('/users/:id/reset-password', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { schoolName } = req.body
    const user = await User.findOne({ _id: req.params.id, schoolId: req.user.schoolId })
    if (!user) return res.status(404).json({ message: 'User not found.' })

    const newPassword = generateTempPassword()
    user.password = newPassword
    user.mustChangePassword = true
    await user.save()

    sendAdminResetEmail({
      to: user.email,
      fullName: user.fullName,
      newPassword,
      schoolName: schoolName || 'Your School',
    })

    res.json({ message: `Password reset. New credentials sent to ${user.email}.` })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
