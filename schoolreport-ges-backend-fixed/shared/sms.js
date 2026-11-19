import { query } from './db.js'
import { log } from './log.js'
import { maskPhone } from './phone.js'

/*
 * Sending SMS. Provider chosen by SMS_PROVIDER:
 *   arkesel  Arkesel (Ghana): SMS_API_KEY, SMS_SENDER_ID (registered sender name, max 11 chars)
 *   log      nothing is sent; each message is only logged (default when not configured)
 *   memory   tests: messages are kept in `smsOutbox`
 * Every message is recorded in sms_messages (without its text) so schools see their usage
 * and stay within their monthly limit.
 */

export const smsOutbox = []

const provider = () => process.env.SMS_PROVIDER || (process.env.NODE_ENV === 'test' ? 'memory' : 'log')

/** True when messages really reach phones. */
export function smsConfigured() {
  const p = provider()
  if (p === 'arkesel') return Boolean(process.env.SMS_API_KEY && process.env.SMS_SENDER_ID)
  return p === 'memory'
}

// GSM-7 characters (plus the extension table, which counts double).
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM_EXT = '^{}\\[~]|€'

/** How many SMS parts a message costs (160/153 plain characters, 70/67 with others). */
export function smsSegments(text) {
  let units = 0
  let unicode = false
  for (const ch of String(text)) {
    if (GSM.includes(ch)) units += 1
    else if (GSM_EXT.includes(ch)) units += 2
    else { unicode = true; break }
  }
  if (unicode) {
    const n = [...String(text)].length
    return n <= 70 ? 1 : Math.ceil(n / 67)
  }
  return units <= 160 ? 1 : Math.ceil(units / 153)
}

/** Replaces characters phones often get as "?" (smart quotes, dashes) with plain ones. */
export function plainSms(text) {
  return String(text)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/\s+/g, ' ').trim()
}

/** Segments this school sent this calendar month. */
export async function monthlyUsage(schoolId) {
  const { rows } = await query(
    `SELECT coalesce(sum(segments), 0)::int AS used FROM sms_messages
      WHERE school_id = $1 AND status = 'sent' AND created_at >= date_trunc('month', now())`,
    [schoolId]
  )
  return rows[0].used
}

async function arkesel(recipients, message) {
  const res = await fetch(process.env.SMS_API_URL || 'https://sms.arkesel.com/api/v2/sms/send', {
    method: 'POST',
    headers: { 'api-key': process.env.SMS_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: process.env.SMS_SENDER_ID,
      message,
      recipients: recipients.map((p) => p.slice(1)), // 233XXXXXXXXX
    }),
    signal: AbortSignal.timeout(15_000),
  })
  let body = null
  try { body = await res.json() } catch { /* not JSON */ }
  if (!res.ok || body?.status !== 'success') {
    throw new Error(`Arkesel answered ${res.status}: ${String(body?.message || 'no message').slice(0, 120)}`)
  }
  const ids = new Map((Array.isArray(body.data) ? body.data : []).map((d) => [String(d.recipient), d.id]))
  return recipients.map((p) => ids.get(p.slice(1)) ?? null)
}

/**
 * Sends one message to one or more phones (+233… form). Returns
 * { sent, failed, segments }. Never throws for delivery problems (they are logged and
 * recorded); throws only for programming errors.
 *   kind: login_code | absence | results | notice | fee_reminder | payment_receipt
 */
export async function sendSms({ to, message, kind, schoolId = null, studentId = null, refDay = null }) {
  const recipients = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean))]
  const text = plainSms(message)
  const segments = smsSegments(text)
  if (!recipients.length) return { sent: 0, failed: 0, segments }
  const p = provider()

  let ids = recipients.map(() => null)
  let error = null
  try {
    if (p === 'arkesel') {
      if (!smsConfigured()) throw new Error('SMS_API_KEY / SMS_SENDER_ID not set')
      // Arkesel takes many recipients per request; keep batches modest.
      ids = []
      for (let i = 0; i < recipients.length; i += 100) ids.push(...await arkesel(recipients.slice(i, i + 100), text))
    } else if (p === 'memory') {
      for (const r of recipients) smsOutbox.push({ to: r, message: text, kind, schoolId, studentId })
    } else {
      log.info('sms not sent (no SMS provider configured)', { kind, to: recipients.map(maskPhone), segments })
    }
  } catch (err) {
    error = err.message
    log.error('sms failed', { kind, to: recipients.map(maskPhone), error })
  }

  const status = error ? 'failed' : 'sent'
  for (const [i, phone] of recipients.entries()) {
    await query(
      `INSERT INTO sms_messages (school_id, kind, to_phone, student_id, ref_day, segments, status, provider, provider_id, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING`,
      [schoolId, kind, phone, studentId, refDay, segments, status, p, ids[i] == null ? null : String(ids[i]), error]
    ).catch((err) => log.error('could not record sms', { err }))
  }
  if (!error) log.info('sms sent', { kind, count: recipients.length, segments, provider: p })
  return { sent: error ? 0 : recipients.length, failed: error ? recipients.length : 0, segments }
}

/** Runs an async job after the response is sent; errors are logged, never thrown. */
export function inBackground(label, fn) {
  setImmediate(() => {
    Promise.resolve().then(fn).catch((err) => log.error(`${label} failed`, { err }))
  })
}
