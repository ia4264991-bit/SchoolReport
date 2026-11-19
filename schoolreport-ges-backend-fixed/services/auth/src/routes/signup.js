import { Router } from 'express'
import crypto from 'node:crypto'
import rateLimit from 'express-rate-limit'
import { query, withTransaction } from '../../../../shared/db.js'
import { ah, HttpError, isEmail, str, requiredStr } from '../../../../shared/http.js'
import { audit } from '../../../../shared/audit.js'
import { log } from '../../../../shared/log.js'
import { normalizeGhanaPhone } from '../../../../shared/phone.js'
import { currentAcademicYear } from '../../../school/src/models/index.js'
import { pricing } from '../../../school/src/billing.js'
import { signToken } from '../middleware/auth.js'
import { USER_COLUMNS, PASSWORD_MIN, PASSWORD_MAX, hashPassword, makeUsername, userToApi } from '../models/User.js'
import { sendSignupCodeEmail, emailConfigured } from '../utils/mailer.js'
import { generateOTP } from '../utils/password.js'

// Mounted at: /api/signup — a school signs itself up and starts a free trial.
//   1. POST /start   details + password → a 6-digit code is emailed
//   2. POST /verify  email + code → school, settings, first admin; the admin is signed in
const router = Router()

const CODE_TTL_MINUTES = 30
const CODE_MAX_ATTEMPTS = 5
const CODES_PER_HOUR = 3

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: parseInt(process.env.SIGNUP_RATE_LIMIT_MAX || '20', 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many sign-up attempts from this network. Please try again in an hour.' },
})

const codeHash = (email, code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(`signup:${email}:${code}`).digest('hex')

// A typical Ghanaian basic school, so a new school can start at once (it can change all of it).
const DEFAULT_CLASSES = [
  ['KG 1', 'Kindergarten'], ['KG 2', 'Kindergarten'],
  ['Basic 1', 'Lower Primary'], ['Basic 2', 'Lower Primary'], ['Basic 3', 'Lower Primary'],
  ['Basic 4', 'Upper Primary'], ['Basic 5', 'Upper Primary'], ['Basic 6', 'Upper Primary'],
]
const DEFAULT_SUBJECTS = [
  'English Language', 'Mathematics', 'Science', 'Our World Our People', 'Religious and Moral Education',
  'History', 'Creative Arts', 'Ghanaian Language', 'Physical Education', 'Computing',
]

async function emailTaken(email) {
  const { rowCount } = await query(
    'SELECT 1 FROM users WHERE email = $1 UNION ALL SELECT 1 FROM schools WHERE email = $1', [email]
  )
  return rowCount > 0
}

/* POST /api/signup/start
   { schoolName, region?, district?, adminName, email, phone, password, setupDefaults?, acceptTerms } */
router.post('/start', limiter, ah(async (req, res) => {
  const b = req.body || {}
  const data = {
    schoolName: requiredStr(b.schoolName, 'School name', { max: 120 }),
    region: str(b.region, 'Region', { max: 60 }),
    district: str(b.district, 'District', { max: 80 }),
    adminName: requiredStr(b.adminName, 'Your name', { max: 120 }),
    setupDefaults: b.setupDefaults !== false,
  }
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.')
  data.phone = normalizeGhanaPhone(b.phone)
  if (!data.phone) throw new HttpError(400, 'Enter a Ghana phone number, e.g. 024 412 3456.')
  if (typeof b.password !== 'string' || b.password.length < PASSWORD_MIN) {
    throw new HttpError(400, `Choose a password of at least ${PASSWORD_MIN} characters.`)
  }
  if (Buffer.byteLength(b.password) > PASSWORD_MAX) throw new HttpError(400, `Password must be at most ${PASSWORD_MAX} characters.`)
  if (b.acceptTerms !== true) throw new HttpError(400, 'Please accept the Terms and the Privacy Policy.')
  if (await emailTaken(email)) throw new HttpError(409, 'This email is already registered. Sign in, or use another email.')

  const code = generateOTP()
  const { rows: [row] } = await query(
    `INSERT INTO signup_requests (email, data, password_hash, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))
     ON CONFLICT (email) DO UPDATE SET
       data = EXCLUDED.data, password_hash = EXCLUDED.password_hash,
       code_hash    = CASE WHEN signup_requests.window_start < now() - interval '1 hour' OR signup_requests.sent_count < $6
                           THEN EXCLUDED.code_hash ELSE signup_requests.code_hash END,
       expires_at   = CASE WHEN signup_requests.window_start < now() - interval '1 hour' OR signup_requests.sent_count < $6
                           THEN EXCLUDED.expires_at ELSE signup_requests.expires_at END,
       attempts     = CASE WHEN signup_requests.window_start < now() - interval '1 hour' OR signup_requests.sent_count < $6
                           THEN 0 ELSE signup_requests.attempts END,
       sent_count   = CASE WHEN signup_requests.window_start < now() - interval '1 hour' THEN 1 ELSE signup_requests.sent_count + 1 END,
       window_start = CASE WHEN signup_requests.window_start < now() - interval '1 hour' THEN now() ELSE signup_requests.window_start END
     RETURNING sent_count`,
    [email, JSON.stringify(data), await hashPassword(b.password), codeHash(email, code), CODE_TTL_MINUTES, CODES_PER_HOUR]
  )
  if (row.sent_count > CODES_PER_HOUR) {
    throw new HttpError(429, 'We already sent several codes to this email. Check your inbox (and spam folder), or try again in an hour.')
  }
  sendSignupCodeEmail({ to: email, fullName: data.adminName, schoolName: data.schoolName, code })
  res.json({
    email,
    emailSent: emailConfigured() || process.env.NODE_ENV === 'test',
    message: `We sent a 6-digit code to ${email}. It is valid for ${CODE_TTL_MINUTES} minutes.`,
  })
}))

/* POST /api/signup/verify { email, code } */
router.post('/verify', limiter, ah(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
  const invalid = new HttpError(400, 'Wrong or expired code. Check the email, or start again for a new code.')
  if (!isEmail(email) || !/^\d{6}$/.test(code)) throw invalid
  const { rows: [r] } = await query(
    'SELECT * FROM signup_requests WHERE email = $1 AND expires_at > now()', [email]
  )
  if (!r || r.attempts >= CODE_MAX_ATTEMPTS) throw invalid
  const ok = crypto.timingSafeEqual(Buffer.from(r.code_hash, 'hex'), Buffer.from(codeHash(email, code), 'hex'))
  if (!ok) {
    await query('UPDATE signup_requests SET attempts = attempts + 1 WHERE email = $1', [email])
    throw invalid
  }

  const d = r.data
  const { trialDays } = pricing()
  let result
  try {
    result = await withTransaction(async (db) => {
      const { rows: [school] } = await db.query(
        `INSERT INTO schools (name, email, region, district, plan, trial_ends_at, phone, signup_source, terms_accepted_at)
         VALUES ($1, $2, $3, $4, 'trial', now() + make_interval(days => $5), $6, 'self', now()) RETURNING *`,
        [d.schoolName, email, d.region || '', d.district || '', trialDays, d.phone]
      )
      await db.query(
        `INSERT INTO school_settings (school_id, school_name, region, district, academic_year)
         VALUES ($1, $2, $3, $4, $5)`,
        [school.id, d.schoolName, d.region || '', d.district || '', currentAcademicYear()]
      )
      const { rows: [admin] } = await db.query(
        `INSERT INTO users (full_name, email, username, password_hash, role, school_id, must_change_password)
         VALUES ($1, $2, $3, $4, 'admin', $5, false)
         RETURNING ${USER_COLUMNS}, token_version`,
        [d.adminName, email, makeUsername(email), r.password_hash, school.id]
      )
      if (d.setupDefaults) {
        await db.query(
          `INSERT INTO classes (school_id, name, level) SELECT $1, c.name, c.level FROM unnest($2::text[], $3::text[]) AS c(name, level)`,
          [school.id, DEFAULT_CLASSES.map((c) => c[0]), DEFAULT_CLASSES.map((c) => c[1])]
        )
        await db.query(
          `INSERT INTO subjects (school_id, name, sort_order) SELECT $1, s.name, s.ord FROM unnest($2::text[]) WITH ORDINALITY AS s(name, ord)`,
          [school.id, DEFAULT_SUBJECTS]
        )
      }
      await db.query('DELETE FROM signup_requests WHERE email = $1', [email])
      await audit(req, 'school.signup', {
        db, schoolId: school.id, targetType: 'school', targetId: school.id,
        actor: { id: admin.id, schoolId: school.id, fullName: admin.full_name, role: 'admin' },
        details: { name: d.schoolName, email, trialDays, defaults: d.setupDefaults },
      })
      return { school, admin }
    })
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'This email is already registered. Sign in instead.')
    throw err
  }
  log.info('school signed up', { school: result.school.id })
  res.status(201).json({
    token: signToken(result.admin.id, result.admin.token_version),
    user: userToApi(result.admin),
    mustChangePassword: false,
    trialEndsAt: result.school.trial_ends_at,
  })
}))

export default router
