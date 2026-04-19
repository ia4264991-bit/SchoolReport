import { Router } from 'express'
import User from '../models/User.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { sendWelcomeEmail, sendAdminResetEmail } from '../utils/mailer.js'
import { generateTempPassword } from '../utils/password.js'

const router = Router()

// Mounted at: /api/users
// All paths below are RELATIVE — no /users/* prefix here.

/* ─────────────────────────────────────────────────────────
   GET /api/users
   Admin — lists users scoped to their school
───────────────────────────────────────────────────────── */
router.get('/', requireAuth, requireRole('admin', 'superadmin'), async (req, res) => {
  try {
    const filter = req.user.role === 'superadmin'
      ? {}
      : { schoolId: req.user.schoolId }
    const users = await User.find(filter).sort({ createdAt: -1 })
    res.json(users)
  } catch { res.status(500).json({ message: 'Server error.' }) }
})

/* ─────────────────────────────────────────────────────────
   POST /api/users
   Admin — create user, auto-generate password, send email
───────────────────────────────────────────────────────── */
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
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

    sendWelcomeEmail({ to: email, fullName, email, tempPassword, role, schoolName: schoolName || 'Your School' })

    res.status(201).json({ user, message: 'User created. Credentials sent to email.' })
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

/* ─────────────────────────────────────────────────────────
   PUT /api/users/:id
   Admin — update user (same school only)
───────────────────────────────────────────────────────── */
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { fullName, email, role, classId, notes, isActive } = req.body
    const user = await User.findOne({ _id: req.params.id, schoolId: req.user.schoolId })
    if (!user) return res.status(404).json({ message: 'User not found in your school.' })

    if (fullName)                      user.fullName = fullName
    if (email)                         user.email    = email.toLowerCase()
    if (role)                          user.role     = role
    if (classId !== undefined)         user.classId  = classId || null
    if (notes   !== undefined)         user.notes    = notes
    if (typeof isActive === 'boolean') user.isActive = isActive

    await user.save()
    res.json(user)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

/* ─────────────────────────────────────────────────────────
   DELETE /api/users/:id
   Admin — soft-delete (deactivate) user in same school
   NOTE: must come BEFORE /:id/reset-password to avoid conflict
───────────────────────────────────────────────────────── */
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
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

/* ─────────────────────────────────────────────────────────
   POST /api/users/:id/reset-password
   Admin — force-reset a user's password, send new credentials
───────────────────────────────────────────────────────── */
router.post('/:id/reset-password', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { schoolName } = req.body
    const user = await User.findOne({ _id: req.params.id, schoolId: req.user.schoolId })
    if (!user) return res.status(404).json({ message: 'User not found.' })

    const newPassword = generateTempPassword()
    user.password = newPassword
    user.mustChangePassword = true
    await user.save()

    sendAdminResetEmail({ to: user.email, fullName: user.fullName, newPassword, schoolName: schoolName || 'Your School' })

    res.json({ message: `Password reset. New credentials sent to ${user.email}.` })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
