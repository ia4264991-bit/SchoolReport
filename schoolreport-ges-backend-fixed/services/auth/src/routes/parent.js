import { Router } from 'express'
import { query, withTransaction } from '../../../../shared/db.js'
import { ah, HttpError, str, termParam } from '../../../../shared/http.js'
import { childrenOf, ownPupil } from '../../../../shared/family.js'
import { paystackConfigured, initializeTransaction, newReference } from '../../../../shared/paystack.js'
import { audit } from '../../../../shared/audit.js'
import { requireAuth, requireRole, requireSchool } from '../middleware/auth.js'
import { ensureSettings } from '../../../school/src/models/index.js'
import { feeStatement, money } from '../../../school/src/fees.js'

// Mounted at: /api/parent — what a signed-in parent sees: their children, attendance,
// fees and the school's notices. Reports: GET /api/reports/me?studentId=…
const router = Router()
router.use(requireAuth, requireSchool, requireRole('parent'))

const sid = (req) => req.user.schoolId

/** Online fee payment needs: Paystack set up, the school's subaccount, and the admin's switch on. */
async function onlineFees(schoolId) {
  const { rows: [r] } = await query(
    `SELECT sc.paystack_subaccount, st.online_fee_payments
       FROM schools sc LEFT JOIN school_settings st ON st.school_id = sc.id WHERE sc.id = $1`,
    [schoolId]
  )
  return { subaccount: r?.paystack_subaccount || null, on: paystackConfigured() && Boolean(r?.paystack_subaccount) && r?.online_fee_payments !== false }
}
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')

/* GET /api/parent/children */
router.get('/children', ah(async (req, res) => {
  const kids = await childrenOf(req.user)
  res.json({
    onlinePayment: (await onlineFees(sid(req))).on,
    children: kids.map((k) => ({ _id: k.id, fullName: k.full_name, gender: k.gender, classId: k.class_id, className: k.class_name || '' })),
  })
}))

/* GET /api/parent/children/:id/attendance?term=&academicYear= */
router.get('/children/:id/attendance', ah(async (req, res) => {
  const studentId = await ownPupil(req, req.params.id)
  const settings = await ensureSettings(sid(req))
  const term = req.query.term ? termParam(String(req.query.term)) : settings.term
  const academicYear = req.query.academicYear ? str(req.query.academicYear, 'Academic year', { max: 20 }) : settings.academic_year
  const { rows } = await query(
    `SELECT r.day, m.status FROM attendance_marks m JOIN attendance_registers r ON r.id = m.register_id
      WHERE r.school_id = $1 AND m.student_id = $2 AND r.academic_year = $3 AND r.term = $4
      ORDER BY r.day DESC`,
    [sid(req), studentId, academicYear, term]
  )
  const present = rows.filter((r) => r.status === 'present').length
  res.json({
    academicYear, term,
    present, absent: rows.length - present, total: rows.length,
    absentDays: rows.filter((r) => r.status === 'absent').map((r) => r.day),
  })
}))

/* GET /api/parent/children/:id/fees */
router.get('/children/:id/fees', ah(async (req, res) => {
  const studentId = await ownPupil(req, req.params.id)
  res.json(await feeStatement(sid(req), studentId, { staff: false }))
}))

/* POST /api/parent/children/:id/fees/pay { amount } — pay by MoMo or card through Paystack.
   The money goes straight to the school's own Paystack subaccount. */
router.post('/children/:id/fees/pay', ah(async (req, res) => {
  const studentId = await ownPupil(req, req.params.id)
  const online = await onlineFees(sid(req))
  if (!online.on) {
    throw new HttpError(409, 'This school takes fees at the school office only. Please pay there; you will get a receipt.')
  }
  const amount = money(req.body?.amount, 'Amount')
  if (amount < 1) throw new HttpError(400, 'The smallest online payment is GHS 1.00.')
  const reference = newReference('SRF')
  const amountPesewas = Math.round(amount * 100)
  await withTransaction(async (db) => {
    await db.query(
      `INSERT INTO online_payments (reference, purpose, school_id, student_id, user_id, amount_pesewas)
       VALUES ($1, 'fees', $2, $3, $4, $5)`,
      [reference, sid(req), studentId, req.user.id, amountPesewas]
    )
    await audit(req, 'fees.online_started', { db, targetType: 'student', targetId: studentId, details: { reference, amount } })
  })
  const { authorizationUrl } = await initializeTransaction({
    // Paystack needs an email; parents sign in by phone, so this is a per-parent placeholder.
    email: `parent-${req.user.id.slice(0, 8)}@parents.schoolreport.online`,
    amountPesewas,
    reference,
    callbackUrl: `${frontend()}/parent`,
    subaccount: online.subaccount,
    metadata: { purpose: 'fees', school_id: sid(req), student_id: studentId },
  })
  res.json({ authorizationUrl, reference, amount })
}))

/* GET /api/parent/notices — school-wide notices and those for their children's classes */
router.get('/notices', ah(async (req, res) => {
  const classIds = [...new Set((await childrenOf(req.user)).map((k) => k.class_id).filter(Boolean))]
  const { rows } = await query(
    `SELECT n.id, n.title, n.body, n.class_id, c.name AS class_name, n.created_at
       FROM notices n LEFT JOIN classes c ON c.id = n.class_id
      WHERE n.school_id = $1 AND (n.class_id IS NULL OR n.class_id = ANY($2::uuid[]))
      ORDER BY n.created_at DESC LIMIT 50`,
    [sid(req), classIds]
  )
  res.json(rows.map((n) => ({ _id: n.id, title: n.title, body: n.body, classId: n.class_id, className: n.class_name || '', createdAt: n.created_at })))
}))

export default router
