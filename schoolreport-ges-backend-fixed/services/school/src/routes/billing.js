import { Router } from 'express'
import { query } from '../../../../shared/db.js'
import { ah, HttpError } from '../../../../shared/http.js'
import { audit } from '../../../../shared/audit.js'
import { subscriptionState, graceDays } from '../../../../shared/subscription.js'
import { paystackConfigured, initializeTransaction, newReference } from '../../../../shared/paystack.js'
import { requireAuth, requireRole, requireSchool } from '../middleware/auth.js'
import { quote, subscriptionPaymentToApi } from '../billing.js'

// Mounted at: /api/billing — the school's own subscription (admin; head can look)
const router = Router()
router.use(requireAuth, requireSchool, requireRole('admin', 'head'))

const sid = (req) => req.user.schoolId
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')

/* GET /api/billing */
router.get('/', ah(async (req, res) => {
  const { rows: [s] } = await query('SELECT plan, trial_ends_at, paid_until FROM schools WHERE id = $1', [sid(req)])
  const { rows: history } = await query(
    'SELECT * FROM subscription_payments WHERE school_id = $1 ORDER BY created_at DESC LIMIT 20', [sid(req)]
  )
  res.json({
    plan: s.plan,
    trialEndsAt: s.trial_ends_at,
    paidUntil: s.paid_until,
    ...subscriptionState(s),
    graceDays: graceDays(),
    quote: await quote(sid(req)),
    onlinePayment: paystackConfigured(),
    history: history.map(subscriptionPaymentToApi),
  })
}))

/* POST /api/billing/pay — start a Paystack payment for one term (admin) */
router.post('/pay', requireRole('admin'), ah(async (req, res) => {
  if (!paystackConfigured()) throw new HttpError(503, 'Online payment is not available yet. Contact us to pay by bank transfer or MoMo.')
  const q = await quote(sid(req))
  const reference = newReference('SRS')
  const amountPesewas = Math.round(q.amount * 100)
  await query(
    `INSERT INTO online_payments (reference, purpose, school_id, user_id, amount_pesewas)
     VALUES ($1, 'subscription', $2, $3, $4)`,
    [reference, sid(req), req.user.id, amountPesewas]
  )
  const { authorizationUrl } = await initializeTransaction({
    email: req.user.email,
    amountPesewas,
    reference,
    callbackUrl: `${frontend()}/billing`,
    metadata: { purpose: 'subscription', school_id: sid(req), pupils: q.pupils },
  })
  await audit(req, 'billing.payment_started', { details: { reference, amount: q.amount, pupils: q.pupils } })
  res.json({ authorizationUrl, reference, amount: q.amount })
}))

export default router
