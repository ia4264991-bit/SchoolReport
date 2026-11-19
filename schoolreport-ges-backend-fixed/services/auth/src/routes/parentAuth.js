import { Router } from 'express'
import crypto from 'node:crypto'
import rateLimit from 'express-rate-limit'
import { query, withTransaction } from '../../../../shared/db.js'
import { ah, HttpError, isUuid } from '../../../../shared/http.js'
import { log } from '../../../../shared/log.js'
import { normalizeGhanaPhone, maskPhone } from '../../../../shared/phone.js'
import { sendSms } from '../../../../shared/sms.js'
import { audit } from '../../../../shared/audit.js'
import { signToken } from '../middleware/auth.js'
import { USER_COLUMNS, userToApi } from '../models/User.js'
import { generateOTP } from '../utils/password.js'

// Mounted at: /api/auth/parent
// Parents sign in with the phone number the school has on record for their child, and a
// 6-digit code sent to that phone by SMS. No email and no password to forget.
const router = Router()

const CODE_TTL_MINUTES = 10
const CODE_MAX_ATTEMPTS = 5
const CODES_PER_HOUR = 3

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '30', 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait 15 minutes and try again.' },
})

const codeHash = (phone, code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(`parent:${phone}:${code}`).digest('hex')

function phoneFrom(body) {
  const phone = normalizeGhanaPhone(body?.phone)
  if (!phone) throw new HttpError(400, 'Enter your phone number, e.g. 024 412 3456.')
  return phone
}

/** Schools (active) with at least one active pupil whose guardian phone is this one. */
async function schoolsForPhone(phone) {
  const { rows } = await query(
    `SELECT DISTINCT sc.id, sc.name
       FROM students s JOIN schools sc ON sc.id = s.school_id AND sc.is_active
      WHERE s.is_active AND (s.guardian_phone = $1 OR s.guardian_phone2 = $1)
      ORDER BY sc.name`,
    [phone]
  )
  return rows
}

/* POST /api/auth/parent/request-code { phone } */
router.post('/request-code', limiter, ah(async (req, res) => {
  const phone = phoneFrom(req.body)
  // Same answer whether or not the number is known, so it can't be used to find parents.
  const reply = {
    message: `If ${maskPhone(phone)} is a parent's number at a school using SchoolReport, a code is on its way by SMS. You can ask for up to ${CODES_PER_HOUR} codes an hour.`,
  }
  if (!(await schoolsForPhone(phone)).length) return res.json(reply)

  const code = generateOTP()
  const { rows: [row] } = await query(
    `INSERT INTO phone_login_codes (phone, code_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3))
     ON CONFLICT (phone) DO UPDATE SET
       code_hash    = CASE WHEN phone_login_codes.window_start < now() - interval '1 hour' OR phone_login_codes.sent_count < $4
                           THEN EXCLUDED.code_hash ELSE phone_login_codes.code_hash END,
       expires_at   = CASE WHEN phone_login_codes.window_start < now() - interval '1 hour' OR phone_login_codes.sent_count < $4
                           THEN EXCLUDED.expires_at ELSE phone_login_codes.expires_at END,
       attempts     = CASE WHEN phone_login_codes.window_start < now() - interval '1 hour' OR phone_login_codes.sent_count < $4
                           THEN 0 ELSE phone_login_codes.attempts END,
       sent_count   = CASE WHEN phone_login_codes.window_start < now() - interval '1 hour' THEN 1
                           ELSE phone_login_codes.sent_count + 1 END,
       window_start = CASE WHEN phone_login_codes.window_start < now() - interval '1 hour' THEN now()
                           ELSE phone_login_codes.window_start END
     RETURNING sent_count`,
    [phone, codeHash(phone, code), CODE_TTL_MINUTES, CODES_PER_HOUR]
  )
  if (row.sent_count > CODES_PER_HOUR) {
    log.warn('parent sign-in code not sent: hourly limit', { to: maskPhone(phone) })
    return res.json(reply)
  }
  await sendSms({
    to: phone,
    kind: 'login_code',
    message: `Your SchoolReport sign-in code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. Do not share it with anyone.`,
  })
  res.json(reply)
}))

/** Checks the code; a wrong guess uses up a try, and the last try cancels the code. */
async function checkCode(phone, code) {
  const invalid = new HttpError(400, 'Wrong or expired code. Ask for a new one.')
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) throw invalid
  const { rows: [row] } = await query(
    'SELECT code_hash, attempts FROM phone_login_codes WHERE phone = $1 AND expires_at > now()', [phone]
  )
  if (!row || row.attempts >= CODE_MAX_ATTEMPTS) throw invalid
  const a = Buffer.from(row.code_hash, 'hex')
  const b = Buffer.from(codeHash(phone, code.trim()), 'hex')
  if (!crypto.timingSafeEqual(a, b)) {
    await query(
      `UPDATE phone_login_codes SET attempts = attempts + 1,
              expires_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE expires_at END
        WHERE phone = $1`,
      [phone, CODE_MAX_ATTEMPTS]
    )
    throw invalid
  }
}

/* POST /api/auth/parent/verify { phone, code, schoolId? }
   With children at more than one school, the first answer is { chooseSchool: [...] } and the
   parent sends the same code again with the school picked. */
router.post('/verify', limiter, ah(async (req, res) => {
  const phone = phoneFrom(req.body)
  await checkCode(phone, req.body?.code)

  const schools = await schoolsForPhone(phone)
  if (!schools.length) throw new HttpError(400, 'No pupil has this number any more. Contact the school.')
  let school = schools[0]
  if (schools.length > 1) {
    const wanted = req.body?.schoolId
    school = isUuid(wanted) ? schools.find((s) => s.id === wanted) : null
    if (!school) return res.json({ chooseSchool: schools.map((s) => ({ _id: s.id, name: s.name })) })
  }

  const user = await withTransaction(async (db) => {
    // A code works once. The row stays (expired) so the hourly SMS count is not reset.
    await db.query('UPDATE phone_login_codes SET expires_at = now() WHERE phone = $1', [phone])
    const { rows: [g] } = await db.query(
      `SELECT guardian_name FROM students
        WHERE school_id = $1 AND is_active AND (guardian_phone = $2 OR guardian_phone2 = $2) AND guardian_name <> ''
        ORDER BY created_at LIMIT 1`,
      [school.id, phone]
    )
    const { rows: [u] } = await db.query(
      `INSERT INTO users (full_name, role, school_id, phone)
       VALUES ($1, 'parent', $2, $3)
       ON CONFLICT (school_id, phone) WHERE role = 'parent'
       DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING ${USER_COLUMNS}, token_version`,
      [g?.guardian_name || 'Parent / Guardian', school.id, phone]
    )
    return u
  })
  if (!user.is_active) throw new HttpError(403, 'This parent login has been switched off by the school.')
  await audit(req, 'auth.parent_login', {
    targetType: 'user', targetId: user.id,
    actor: { id: user.id, schoolId: school.id, fullName: user.full_name, role: 'parent' },
  })
  log.info('parent login', { reqId: req.id, user: user.id })
  res.json({ token: signToken(user.id, user.token_version), user: userToApi(user), mustChangePassword: false })
}))

export default router
