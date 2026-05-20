import { Router } from 'express'
import User from '../models/User.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { sendWelcomeEmail, sendAdminResetEmail } from '../utils/mailer.js'
import { generateTempPassword } from '../utils/password.js'

const router = Router()
// Mounted at: /api/users

/* GET /api/users */
router.get('/', requireAuth, requireRole('admin', 'superadmin'), async (req, res) => {
  try {
    const filter = req.user.role === 'superadmin' ? {} : { schoolId: req.user.schoolId }
    const users  = await User.find(filter).sort({ createdAt: -1 })
    res.json(users)
  } catch { res.status(500).json({ message: 'Server error.' }) }
})

/* POST /api/users */
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { fullName, email, role, classId, notes, schoolName } = req.body
    if (!fullName || !email || !role)
      return res.status(400).json({ message: 'fullName, email and role are required.' })

    const validRoles = ['admin', 'head', 'teacher', 'student']
    if (!validRoles.includes(role))
      return res.status(400).json({ message: `Invalid role. Must be one of: ${validRoles.join(', ')}` })

    const exists = await User.findOne({ email: email.toLowerCase() })
    if (exists) return res.status(409).json({ message: 'A user with this email already exists.' })

    const tempPassword = generateTempPassword()

    // Build unique username: email prefix + last 6 chars of schoolId
    const emailPrefix  = email.toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '')
    const uniqueSuffix = req.user.schoolId?.toString().slice(-6) || Date.now().toString().slice(-6)
    const username     = `${emailPrefix}_${uniqueSuffix}`

    const user = await User.create({
      fullName,
      email:              email.toLowerCase(),
      username,
      password:           tempPassword,
      role,
      schoolId:           req.user.schoolId,
      classId:            classId || null,
      notes:              notes   || '',
      mustChangePassword: true,
    })

    const emailSent = await sendWelcomeEmail({
      to: email, fullName, email, tempPassword, role,
      schoolName: schoolName || 'Your School',
    })

    res.status(201).json({
      user,
      emailSent,
      credentials: {
        email,
        password: tempPassword,
        note: emailSent ? 'Credentials emailed.' : '⚠️ Email failed — share password manually.',
      },
      message: 'User created.',
    })
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field'
      return res.status(409).json({
        message: `A user with that ${field} already exists.`,
      })
    }
    res.status(400).json({ message: err.message })
  }
})

/* PUT /api/users/:id */
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
  } catch (err) { res.status(400).json({ message: err.message }) }
})

/* DELETE /api/users/:id */
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (req.params.id === req.user.id)
      return res.status(400).json({ message: 'You cannot delete your own account.' })

    const user = await User.findOne({ _id: req.params.id, schoolId: req.user.schoolId })
    if (!user) return res.status(404).json({ message: 'User not found.' })
    user.isActive = false
    await user.save()
    res.json({ message: 'User deactivated.' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* POST /api/users/:id/reset-password */
router.post('/:id/reset-password', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { schoolName } = req.body
    const user = await User.findOne({ _id: req.params.id, schoolId: req.user.schoolId })
    if (!user) return res.status(404).json({ message: 'User not found.' })

    const newPassword = generateTempPassword()
    user.password           = newPassword
    user.mustChangePassword = true
    await user.save()

    const emailSent = await sendAdminResetEmail({
      to: user.email, fullName: user.fullName,
      newPassword, schoolName: schoolName || 'Your School',
    })

    res.json({
      message: `Password reset for ${user.fullName}.`,
      emailSent,
      credentials: {
        email:    user.email,
        password: newPassword,
        note: emailSent ? 'New credentials emailed.' : '⚠️ Email failed — share password manually.',
      },
    })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

export default router
