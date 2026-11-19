import { Router } from 'express'
import { query, withTransaction } from '../../../../shared/db.js'
import { ah, HttpError, isEmail, str, requiredStr, idParam, dateOrNull } from '../../../../shared/http.js'
import { subscriptionState } from '../../../../shared/subscription.js'
import { extendSubscription, subscriptionPaymentToApi } from '../../../school/src/billing.js'
import { money } from '../../../school/src/fees.js'
import { audit } from '../../../../shared/audit.js'
import { schoolToApi, currentAcademicYear } from '../../../school/src/models/index.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { USER_COLUMNS, hashPassword, makeUsername, userToApi } from '../models/User.js'
import { sendWelcomeEmail, emailConfigured } from '../utils/mailer.js'
import { generateTempPassword } from '../utils/password.js'

const router = Router()
// Mounted at: /api/superadmin
router.use(requireAuth, requireRole('superadmin'))

/* POST /api/superadmin/schools — create a school and its first admin in one transaction */
router.post('/schools', ah(async (req, res) => {
  const b = req.body || {}
  const schoolName  = requiredStr(b.schoolName, 'School name')
  const schoolEmail = requiredStr(b.schoolEmail, 'School email').toLowerCase()
  const adminName   = requiredStr(b.adminName, 'Admin name')
  const adminEmail  = requiredStr(b.adminEmail, 'Admin email').toLowerCase()
  const circuit     = str(b.circuit, 'Circuit')
  const district    = str(b.district, 'District')
  const region      = str(b.region, 'Region')
  if (!isEmail(schoolEmail)) throw new HttpError(400, 'School email is not a valid email address.')
  if (!isEmail(adminEmail))  throw new HttpError(400, 'Admin email is not a valid email address.')

  const [userExists, schoolExists] = await Promise.all([
    query('SELECT 1 FROM users WHERE email = $1', [adminEmail]),
    query('SELECT 1 FROM schools WHERE email = $1', [schoolEmail]),
  ])
  if (userExists.rowCount)   throw new HttpError(409, `A user with email "${adminEmail}" already exists.`)
  if (schoolExists.rowCount) throw new HttpError(409, `A school with email "${schoolEmail}" already exists.`)

  const tempPassword = generateTempPassword()
  const passwordHash = await hashPassword(tempPassword)

  let school, admin
  try {
    ({ school, admin } = await withTransaction(async (db) => {
      const s = await db.query(
        `INSERT INTO schools (name, email, circuit, district, region)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [schoolName, schoolEmail, circuit, district, region]
      )
      await db.query(
        `INSERT INTO school_settings (school_id, school_name, circuit, district, region, academic_year)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [s.rows[0].id, schoolName, circuit, district, region, currentAcademicYear()]
      )
      const u = await db.query(
        `INSERT INTO users (full_name, email, username, password_hash, role, school_id, must_change_password)
         VALUES ($1, $2, $3, $4, 'admin', $5, true)
         RETURNING ${USER_COLUMNS}`,
        [adminName, adminEmail, makeUsername(adminEmail), passwordHash, s.rows[0].id]
      )
      await audit(req, 'school.create', {
        db, schoolId: s.rows[0].id, targetType: 'school', targetId: s.rows[0].id,
        details: { name: schoolName, email: schoolEmail, adminEmail },
      })
      return { school: s.rows[0], admin: u.rows[0] }
    }))
  } catch (err) {
    // Someone created the same email between the check above and this insert.
    if (err.code === '23505') {
      throw new HttpError(409, err.constraint === 'schools_email_key'
        ? `A school with email "${schoolEmail}" already exists.`
        : `A user with email "${adminEmail}" already exists.`)
    }
    throw err
  }

  // Sent in the background so a slow mail server never blocks this response.
  sendWelcomeEmail({
    to: adminEmail, fullName: adminName, email: adminEmail,
    tempPassword, role: 'admin', schoolName,
  })

  res.status(201).json({
    message: `School "${schoolName}" created successfully.`,
    school: schoolToApi(school),
    admin: userToApi(admin),
    emailQueued: emailConfigured(),
    credentials: {
      loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`,
      email: adminEmail,
      password: tempPassword,
    },
  })
}))

/* GET /api/superadmin/schools — with plan status, pupils and SMS used this month */
router.get('/schools', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT sc.*,
            (SELECT count(*) FROM students s WHERE s.school_id = sc.id AND s.is_active)::int AS pupils,
            (SELECT coalesce(sum(segments), 0) FROM sms_messages m
              WHERE m.school_id = sc.id AND m.status = 'sent' AND m.created_at >= date_trunc('month', now()))::int AS sms_used
       FROM schools sc ORDER BY sc.created_at DESC`
  )
  res.json(rows.map((r) => ({ ...schoolToApi(r), pupils: r.pupils, smsUsedThisMonth: r.sms_used, subscription: subscriptionState(r) })))
}))

/* PUT /api/superadmin/schools/:id/billing
   { plan?, trialEndsAt?, paidUntil?, smsMonthlyLimit?, paystackSubaccount? } */
router.put('/schools/:id/billing', ah(async (req, res) => {
  const id = idParam(req.params.id, 'School')
  const b = req.body || {}
  const { rows: [old] } = await query('SELECT * FROM schools WHERE id = $1', [id])
  if (!old) throw new HttpError(404, 'School not found.')
  const next = {
    plan: b.plan !== undefined ? b.plan : old.plan,
    trial_ends_at: b.trialEndsAt !== undefined ? dateOrNull(b.trialEndsAt, 'Trial end') : old.trial_ends_at,
    paid_until: b.paidUntil !== undefined ? dateOrNull(b.paidUntil, 'Paid until') : old.paid_until,
    sms_monthly_limit: b.smsMonthlyLimit !== undefined ? Number(b.smsMonthlyLimit) : old.sms_monthly_limit,
    paystack_subaccount: b.paystackSubaccount !== undefined ? (str(b.paystackSubaccount, 'Paystack subaccount', { max: 40 }) || null) : old.paystack_subaccount,
  }
  if (!['complimentary', 'trial', 'paid'].includes(next.plan)) throw new HttpError(400, 'Plan must be complimentary, trial or paid.')
  if (!Number.isInteger(next.sms_monthly_limit) || next.sms_monthly_limit < 0 || next.sms_monthly_limit > 1_000_000) {
    throw new HttpError(400, 'The SMS limit must be a whole number.')
  }
  if (next.paystack_subaccount && !/^ACCT_[A-Za-z0-9]+$/.test(next.paystack_subaccount)) {
    throw new HttpError(400, 'A Paystack subaccount code looks like ACCT_xxxxxxxx.')
  }
  const { rows: [r] } = await query(
    `UPDATE schools SET plan = $2, trial_ends_at = $3, paid_until = $4, sms_monthly_limit = $5, paystack_subaccount = $6
      WHERE id = $1 RETURNING *`,
    [id, next.plan, next.trial_ends_at, next.paid_until, next.sms_monthly_limit, next.paystack_subaccount]
  )
  await audit(req, 'school.billing_update', {
    schoolId: id, targetType: 'school', targetId: id,
    details: { plan: [old.plan, r.plan], trialEndsAt: [old.trial_ends_at, r.trial_ends_at], paidUntil: [old.paid_until, r.paid_until],
      smsMonthlyLimit: [old.sms_monthly_limit, r.sms_monthly_limit], paystackSubaccount: [old.paystack_subaccount, r.paystack_subaccount] },
  })
  res.json({ ...schoolToApi(r), subscription: subscriptionState(r) })
}))

/* POST /api/superadmin/schools/:id/payments { amount, months?, reference?, note? }
   A subscription paid outside the app (bank transfer, MoMo to the company). */
router.post('/schools/:id/payments', ah(async (req, res) => {
  const id = idParam(req.params.id, 'School')
  const b = req.body || {}
  const amount = money(b.amount, 'Amount')
  const months = b.months === undefined ? undefined : Number(b.months)
  if (months !== undefined && (!Number.isInteger(months) || months < 1 || months > 24)) throw new HttpError(400, 'Months must be 1 to 24.')
  const pay = await withTransaction(async (db) => {
    const { rows: [s] } = await db.query('SELECT id FROM schools WHERE id = $1', [id])
    if (!s) throw new HttpError(404, 'School not found.')
    const { rows: [n] } = await db.query('SELECT count(*)::int AS n FROM students WHERE school_id = $1 AND is_active', [id])
    const p = await extendSubscription(db, id, {
      amount, pupils: n.n, method: 'manual', months,
      reference: str(b.reference, 'Reference', { max: 80 }) || null,
      note: str(b.note, 'Note', { max: 200 }), recordedByName: req.user.fullName,
    })
    await audit(req, 'billing.manual_payment', { db, schoolId: id, targetType: 'school', targetId: id, details: { amount, periodEnd: p.period_end } })
    return p
  })
  res.status(201).json(subscriptionPaymentToApi(pay))
}))

/* PUT /api/superadmin/schools/:id/toggle — activate / deactivate a school */
router.put('/schools/:id/toggle', ah(async (req, res) => {
  const id = idParam(req.params.id, 'School')
  const { rows } = await query(
    'UPDATE schools SET is_active = NOT is_active WHERE id = $1 RETURNING *',
    [id]
  )
  if (!rows[0]) throw new HttpError(404, 'School not found.')
  await audit(req, rows[0].is_active ? 'school.activate' : 'school.deactivate', {
    schoolId: id, targetType: 'school', targetId: id, details: { name: rows[0].name },
  })
  res.json({
    message: `School ${rows[0].is_active ? 'activated' : 'deactivated'}.`,
    school: schoolToApi(rows[0]),
  })
}))

export default router
