import { Router } from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { sendPasswordResetEmail } from '../utils/mailer.js'
import { generateResetToken } from '../utils/password.js'

const router = Router()

// Mounted at: /api/auth
// All paths below are RELATIVE — no /auth/* prefix here.

/* ─────────────────────────────────────────────────────────
   POST /api/auth/login
───────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────
   GET /api/auth/me
───────────────────────────────────────────────────────── */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })
    res.json(user)
  } catch { res.status(500).json({ message: 'Server error.' }) }
})

/* ─────────────────────────────────────────────────────────
   POST /api/auth/change-password
───────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────
   POST /api/auth/forgot-password
───────────────────────────────────────────────────────── */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'Email is required.' })

    const user = await User.findOne({ email: email.toLowerCase(), isActive: true })
    // Always 200 — never reveal whether email exists
    if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' })

    const token = generateResetToken()
    user.resetToken = token
    user.resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000)
    await user.save()

    await sendPasswordResetEmail({ to: user.email, fullName: user.fullName, resetToken: token })
    res.json({ message: 'If that email exists, a reset link has been sent.' })
  } catch (err) {
    console.error('[Auth] Forgot-password:', err)
    res.status(500).json({ message: 'Server error.' })
  }
})

/* ─────────────────────────────────────────────────────────
   POST /api/auth/reset-password
───────────────────────────────────────────────────────── */
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

export default router
