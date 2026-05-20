import { Router } from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'
import { sendOTPEmail, sendTestEmail } from '../utils/mailer.js'
import { generateOTP } from '../utils/password.js'

const router = Router()
// Mounted at: /api/auth  — all paths here are RELATIVE

/* POST /api/auth/login */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required.' })

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

/* GET /api/auth/me */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })
    res.json(user)
  } catch { res.status(500).json({ message: 'Server error.' }) }
})

/* POST /api/auth/change-password  (first-login forced change) */
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Current and new passwords are required.' })
    if (newPassword.length < 8)
      return res.status(400).json({ message: 'New password must be at least 8 characters.' })

    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })

    const match = await user.comparePassword(currentPassword)
    if (!match) return res.status(400).json({ message: 'Current password is incorrect.' })

    user.password           = newPassword
    user.mustChangePassword = false
    await user.save()
    res.json({ message: 'Password changed successfully.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* POST /api/auth/forgot-password  — Step 1: send OTP */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'Email is required.' })

    const user = await User.findOne({ email: email.toLowerCase(), isActive: true })
    // Always 200 — never reveal if email exists
    if (!user) return res.json({ message: 'If that email is registered, an OTP has been sent.' })

    const otp = generateOTP()
    user.otpCode   = otp
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000)  // 10 min
    await user.save()

    await sendOTPEmail({ to: user.email, fullName: user.fullName, otp })

    res.json({ message: 'If that email is registered, an OTP has been sent.' })
  } catch (err) {
    console.error('[Auth] forgot-password:', err)
    res.status(500).json({ message: 'Server error.' })
  }
})

/* POST /api/auth/verify-otp  — Step 2: confirm code is valid */
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body
    if (!email || !otp)
      return res.status(400).json({ message: 'Email and OTP are required.' })

    const user = await User.findOne({
      email:     email.toLowerCase(),
      otpCode:   otp.trim(),
      otpExpiry: { $gt: new Date() },
      isActive:  true,
    })

    if (!user)
      return res.status(400).json({ message: 'Invalid or expired OTP. Please request a new code.' })

    res.json({ valid: true, message: 'OTP verified. You may now set a new password.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* POST /api/auth/reset-password  — Step 3: verify OTP + set new password */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body
    if (!email || !otp || !newPassword)
      return res.status(400).json({ message: 'Email, OTP and new password are all required.' })
    if (newPassword.length < 8)
      return res.status(400).json({ message: 'Password must be at least 8 characters.' })

    const user = await User.findOne({
      email:     email.toLowerCase(),
      otpCode:   otp.trim(),
      otpExpiry: { $gt: new Date() },
      isActive:  true,
    })

    if (!user)
      return res.status(400).json({ message: 'Invalid or expired OTP. Please start again.' })

    user.password           = newPassword
    user.mustChangePassword = false
    user.otpCode            = null
    user.otpExpiry          = null
    await user.save()

    res.json({ message: 'Password reset successfully. You can now log in.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* POST /api/auth/test-email  — DEV diagnostic, remove before going live */
router.post('/test-email', async (req, res) => {
  const { to } = req.body
  if (!to) return res.status(400).json({ message: '"to" email address is required.' })
  try {
    await sendTestEmail(to)
    res.json({
      success: true,
      message: `Test email sent to ${to}. Check inbox and spam.`,
      config: {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        user: process.env.SMTP_USER,
        from: process.env.EMAIL_FROM,
      },
    })
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'SMTP failed — see error below.',
      error:   err.message,
      config: {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        user: process.env.SMTP_USER,
        from: process.env.EMAIL_FROM,
      },
    })
  }
})

export default router
