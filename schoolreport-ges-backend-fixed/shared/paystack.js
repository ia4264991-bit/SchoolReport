import crypto from 'node:crypto'
import { HttpError } from './http.js'
import { log } from './log.js'

/*
 * Paystack (cards and Mobile Money in Ghana). Needs PAYSTACK_SECRET_KEY (sk_test_… or
 * sk_live_…). PAYSTACK_API_BASE is only changed in tests.
 * Flow: we create a transaction → the payer is sent to Paystack's page → Paystack calls our
 * webhook (signed) and redirects the payer back; both paths confirm with a verify call, and
 * recording is idempotent, so a payment is counted exactly once.
 */

const base = () => process.env.PAYSTACK_API_BASE || 'https://api.paystack.co'

export const paystackConfigured = () => Boolean(process.env.PAYSTACK_SECRET_KEY)

async function call(method, path, body) {
  if (!paystackConfigured()) throw new HttpError(503, 'Online payment is not set up yet.')
  let res
  try {
    res = await fetch(base() + path, {
      method,
      headers: {
        authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    log.error('paystack unreachable', { path: path.split('/').slice(0, 3).join('/'), error: err.message })
    throw new HttpError(502, 'The payment service could not be reached. Please try again.')
  }
  let json = null
  try { json = await res.json() } catch { /* not JSON */ }
  if (!res.ok || !json?.status) {
    log.error('paystack error', { status: res.status, message: json?.message })
    throw new HttpError(502, 'The payment service refused the request. Please try again later.')
  }
  return json.data
}

/** Returns { authorizationUrl, reference }. amountPesewas: whole pesewas (GHS × 100). */
export async function initializeTransaction({ email, amountPesewas, reference, callbackUrl, subaccount, metadata }) {
  const data = await call('POST', '/transaction/initialize', {
    email,
    amount: amountPesewas,
    currency: 'GHS',
    reference,
    callback_url: callbackUrl,
    channels: ['mobile_money', 'card'],
    ...(subaccount ? { subaccount, bearer: 'subaccount' } : {}),
    metadata,
  })
  return { authorizationUrl: data.authorization_url, reference: data.reference }
}

/** Returns Paystack's transaction: { status, amount, currency, channel, id, … }. */
export const verifyTransaction = (reference) => call('GET', `/transaction/verify/${encodeURIComponent(reference)}`)

/** Webhook: x-paystack-signature is HMAC-SHA512 of the raw body with the secret key. */
export function validWebhookSignature(rawBody, signature) {
  if (!paystackConfigured() || typeof signature !== 'string' || !Buffer.isBuffer(rawBody)) return false
  const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Unique, unguessable payment reference, e.g. "SRF-lq3k2m-9f2c1a7d". */
export function newReference(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`
}
