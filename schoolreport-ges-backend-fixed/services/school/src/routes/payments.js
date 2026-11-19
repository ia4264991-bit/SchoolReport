import { Router } from 'express'
import { query } from '../../../../shared/db.js'
import { ah, HttpError } from '../../../../shared/http.js'
import { log } from '../../../../shared/log.js'
import { validWebhookSignature, verifyTransaction } from '../../../../shared/paystack.js'
import { requireAuth } from '../middleware/auth.js'
import { settleOnlinePayment } from '../payments.js'

/**
 * POST /api/payments/paystack/webhook — Paystack calls this when a payment succeeds.
 * Mounted before the JSON parser: the signature is over the raw bytes. A bad signature is
 * refused; anything else answers 200 once recorded (Paystack retries on errors).
 */
export const paystackWebhook = ah(async (req, res) => {
  if (!validWebhookSignature(req.body, req.headers['x-paystack-signature'])) {
    log.warn('paystack webhook with a bad signature', { ip: req.ip })
    return res.status(401).json({ message: 'Invalid signature.' })
  }
  let event
  try { event = JSON.parse(req.body.toString('utf8')) } catch { return res.status(400).json({ message: 'Bad JSON.' }) }
  const reference = event?.data?.reference
  if (event?.event === 'charge.success' && typeof reference === 'string' && reference.length <= 100) {
    // Confirm with Paystack itself rather than trusting the event body alone.
    const tx = await verifyTransaction(reference)
    const r = await settleOnlinePayment(reference, tx)
    log.info('paystack webhook handled', { reference, result: r.status })
  }
  res.json({ received: true })
})

// Mounted at: /api/payments
const router = Router()

/* GET /api/payments/paystack/verify/:reference — the payer's return page asks how it went */
router.get('/paystack/verify/:reference', requireAuth, ah(async (req, res) => {
  const reference = String(req.params.reference)
  if (!/^SR[FS]-[a-z0-9]+-[0-9a-f]{10}$/.test(reference)) throw new HttpError(404, 'Payment not found.')
  const { rows: [op] } = await query('SELECT * FROM online_payments WHERE reference = $1', [reference])
  // Only the person who started it — or, for the subscription, an admin of that school.
  const mine = op && (op.user_id === req.user.id
    || (op.purpose === 'subscription' && op.school_id === req.user.schoolId && req.user.role === 'admin'))
  if (!mine) throw new HttpError(404, 'Payment not found.')
  const tx = op.status === 'pending' ? await verifyTransaction(reference) : null
  const r = await settleOnlinePayment(reference, tx)
  res.json({ ...r, amount: op.amount_pesewas / 100 })
}))

export default router
