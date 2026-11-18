import { Router } from 'express'
import crypto from 'node:crypto'
import rateLimit from 'express-rate-limit'
import { query } from '../../../../shared/db.js'
import { ah, HttpError, isEmail } from '../../../../shared/http.js'
import { audit } from '../../../../shared/audit.js'
import { log } from '../../../../shared/log.js'
import { requireAuthAllowPasswordChange, signToken } from '../middleware/auth.js'
import {
  USER_COLUMNS, PASSWORD_MIN, PASSWORD_MAX,
  hashPassword, verifyPassword, hashOtp, userToApi,
} from '../models/User.js'
import { sendOTPEmail } from '../utils/mailer.js'
import { generateOTP } from '../utils/password.js'

const router = Router()
// Mounted at: /api/auth — all paths here are relative

const OTP_TTL_MINUTES = 10
const OTP_MAX_ATTEMPTS = 5

const emailFrom = (body) => (typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '')
const WINDOW_MS = 15 * 60 * 1000
const tooMany = { message: 'Too many attempts. Please wait 15 minutes and try again.' }

// Password-reset steps: per client IP over 15 minutes.
const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '30', 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: tooMany,
})

// Login, per IP: only FAILED attempts count. A whole school often shares one public IP,
// so successful staff logins must not use up the allowance.
const loginIpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: parseInt(process.env.LOGIN_IP_FAIL_LIMIT || '100', 10),
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: tooMany,
})

// Login, per account: 10 failed tries on one email pause that account for 15 minutes,
// whatever IPs the guesses come from.
const loginAccountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: parseInt(process.env.LOGIN_ACCOUNT_FAIL_LIMIT || '10', 10),
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `acct:${emailFrom(req.body) || 'none'}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many failed attempts for this account. Please wait 15 minutes or reset your password.' },
})

function checkNewPassword(pw) {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) {
    throw new HttpError(400, `Password must be at least ${PASSWORD_MIN} characters.`)
  }
  if (Buffer.byteLength(pw) > PASSWORD_MAX) {
    throw new HttpError(400, `Password must be at most ${PASSWORD_MAX} characters.`)
  }
}

/* POST /api/auth/login */
router.post('/login', loginIpLimiter, loginAccountLimiter, ah(async (req, res) => {
  const email = emailFrom(req.body)
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!email || !password) throw new HttpError(400, 'Email and password are required.')

  const { rows } = await query(
    `SELECT u.*, s.is_active AS school_active
       FROM users u LEFT JOIN schools s ON s.id = u.school_id
      WHERE u.email = $1`,
    [email]
  )
  const user = rows[0]
  const match = await verifyPassword(password, user?.password_hash)
  if (!user || !match || !user.is_active) {
    log.warn('login failed', { reqId: req.id, ip: req.ip, known: Boolean(user), active: user?.is_active })
    throw new HttpError(401, 'Invalid email or password.')
  }
  if (user.school_id && !user.school_active) {
    throw new HttpError(403, "This school's account is deactivated. Contact the platform administrator.")
  }
  log.info('login', { reqId: req.id, ip: req.ip, user: user.id, role: user.role })

  res.json({
    token: signToken(user.id, user.token_version),
    user: userToApi(user),
    mustChangePassword: user.must_change_password,
  })
}))

/* GET /api/auth/me — fresh copy of the signed-in user */
router.get('/me', requireAuthAllowPasswordChange, ah(async (req, res) => {
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.user.id])
  res.json(userToApi(rows[0]))
}))

/* POST /api/auth/change-password (also the forced first-login change) */
router.post('/change-password', requireAuthAllowPasswordChange, ah(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {}
  if (typeof currentPassword !== 'string' || !currentPassword || !newPassword) {
    throw new HttpError(400, 'Current and new passwords are required.')
  }
  checkNewPassword(newPassword)
  if (newPassword === currentPassword) {
    throw new HttpError(400, 'New password must be different from the current one.')
  }

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])
  if (!(await verifyPassword(currentPassword, rows[0]?.password_hash))) {
    throw new HttpError(400, 'Current password is incorrect.')
  }

  // Bumping token_version signs out every other session; this one gets a fresh token.
  const updated = await query(
    `UPDATE users SET password_hash = $2, must_change_password = false, token_version = token_version + 1,
            otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0
      WHERE id = $1
      RETURNING token_version`,
    [req.user.id, await hashPassword(newPassword)]
  )
  await audit(req, 'auth.change_password', { targetType: 'user', targetId: req.user.id })
  res.json({
    message: 'Password changed successfully.',
    token: signToken(req.user.id, updated.rows[0].token_version),
  })
}))

/* POST /api/auth/forgot-password — step 1: email a 6-digit code */
router.post('/forgot-password', authLimiter, ah(async (req, res) => {
  const email = emailFrom(req.body)
  if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email address.')

  // Same answer whether or not the email exists, so it can't be used to find accounts.
  const reply = { message: 'If that email is registered, a reset code has been sent.' }

  const { rows } = await query(
    'SELECT id, full_name, email FROM users WHERE email = $1 AND is_active',
    [email]
  )
  const user = rows[0]
  if (!user) return res.json(reply)

  const otp = generateOTP()
  await query(
    `UPDATE users SET otp_hash = $2, otp_expires_at = now() + make_interval(mins => $3), otp_attempts = 0
      WHERE id = $1`,
    [user.id, hashOtp(user.id, otp), OTP_TTL_MINUTES]
  )
  sendOTPEmail({ to: user.email, fullName: user.full_name, otp }) // background, does not block
  res.json(reply)
}))

/**
 * Checks a reset code. A wrong guess uses up one of OTP_MAX_ATTEMPTS tries; after the
 * last one the code is cancelled, which stops anyone guessing all 900,000 codes.
 * Returns the user id when the code is right.
 */
async function checkOtp(email, otp) {
  const invalid = new HttpError(400, 'Invalid or expired code. Please request a new one.')
  if (!email || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) throw invalid

  const { rows } = await query(
    `SELECT id, otp_hash, otp_attempts FROM users
      WHERE email = $1 AND is_active AND otp_hash IS NOT NULL AND otp_expires_at > now()`,
    [email]
  )
  const user = rows[0]
  if (!user || user.otp_attempts >= OTP_MAX_ATTEMPTS) throw invalid

  const expected = Buffer.from(user.otp_hash, 'hex')
  const given = Buffer.from(hashOtp(user.id, otp.trim()), 'hex')
  if (!crypto.timingSafeEqual(expected, given)) {
    if (user.otp_attempts + 1 >= OTP_MAX_ATTEMPTS) log.warn('reset code locked after too many wrong tries', { user: user.id })
    await query(
      `UPDATE users SET otp_attempts = otp_attempts + 1,
              otp_hash       = CASE WHEN otp_attempts + 1 >= $2 THEN NULL ELSE otp_hash END,
              otp_expires_at = CASE WHEN otp_attempts + 1 >= $2 THEN NULL ELSE otp_expires_at END
        WHERE id = $1`,
      [user.id, OTP_MAX_ATTEMPTS]
    )
    throw invalid
  }
  return user.id
}

/* POST /api/auth/verify-otp — step 2: confirm the code before showing the new-password form */
router.post('/verify-otp', authLimiter, ah(async (req, res) => {
  await checkOtp(emailFrom(req.body), req.body?.otp)
  res.json({ valid: true, message: 'Code verified. You may now set a new password.' })
}))

/* POST /api/auth/reset-password — step 3: code + new password */
router.post('/reset-password', authLimiter, ah(async (req, res) => {
  checkNewPassword(req.body?.newPassword)
  const userId = await checkOtp(emailFrom(req.body), req.body?.otp)
  const { rows } = await query(
    `UPDATE users SET password_hash = $2, must_change_password = false, token_version = token_version + 1,
            otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0
      WHERE id = $1
      RETURNING id, school_id, full_name, role`,
    [userId, await hashPassword(req.body.newPassword)]
  )
  const u = rows[0]
  // No one is signed in here: record the user themself as the actor.
  await audit(req, 'auth.reset_password', {
    targetType: 'user', targetId: u.id,
    actor: { id: u.id, schoolId: u.school_id, fullName: u.full_name, role: u.role },
  })
  res.json({ message: 'Password reset successfully. You can now log in.' })
}))

export default router
