import { withTransaction } from '../../../shared/db.js'
import { log } from '../../../shared/log.js'
import { today } from '../../../shared/dates.js'
import { ensureSettings } from './models/index.js'
import { insertPayment } from './fees.js'
import { extendSubscription } from './billing.js'

/**
 * Records a Paystack transaction we started (online_payments row) once Paystack confirms
 * it. Called from the webhook and from the payer's return page; whichever comes first
 * records it, the other finds it already done. The amount and currency must match what we
 * asked for, or nothing is recorded.
 *
 * `tx` is Paystack's verified transaction ({ status, amount, currency, channel, … }).
 * Returns { status: 'success' | 'pending' | 'failed' | 'unknown', purpose, receiptNo?, paidUntil? }.
 */
export async function settleOnlinePayment(reference, tx) {
  return withTransaction(async (db) => {
    const { rows: [op] } = await db.query('SELECT * FROM online_payments WHERE reference = $1 FOR UPDATE', [reference])
    if (!op) return { status: 'unknown' }
    const done = async () => {
      if (op.purpose === 'fees') {
        const { rows: [p] } = await db.query('SELECT receipt_no, id FROM fee_payments WHERE paystack_reference = $1', [reference])
        return { status: 'success', purpose: op.purpose, receiptNo: p?.receipt_no, paymentId: p?.id, studentId: op.student_id }
      }
      const { rows: [s] } = await db.query('SELECT paid_until FROM schools WHERE id = $1', [op.school_id])
      return { status: 'success', purpose: op.purpose, paidUntil: s.paid_until }
    }
    if (op.status === 'success') return done()
    if (op.status === 'failed') return { status: 'failed', purpose: op.purpose }

    if (tx?.status !== 'success') {
      if (['failed', 'reversed'].includes(tx?.status)) {
        await db.query("UPDATE online_payments SET status = 'failed', completed_at = now() WHERE reference = $1", [reference])
        return { status: 'failed', purpose: op.purpose }
      }
      return { status: 'pending', purpose: op.purpose }
    }
    if (Number(tx.amount) !== op.amount_pesewas || tx.currency !== op.currency) {
      log.error('paystack amount mismatch: payment not recorded', { reference, expected: op.amount_pesewas, got: tx.amount, currency: tx.currency })
      await db.query("UPDATE online_payments SET status = 'failed', completed_at = now() WHERE reference = $1", [reference])
      return { status: 'failed', purpose: op.purpose }
    }

    const channel = typeof tx.channel === 'string' ? tx.channel.slice(0, 30) : null
    await db.query(
      "UPDATE online_payments SET status = 'success', channel = $2, completed_at = now() WHERE reference = $1",
      [reference, channel]
    )
    const amount = op.amount_pesewas / 100
    if (op.purpose === 'fees') {
      const settings = await ensureSettings(op.school_id, db)
      await insertPayment(db, {
        schoolId: op.school_id, studentId: op.student_id, amount, method: 'online',
        reference, paidOn: today(), note: channel === 'mobile_money' ? 'Mobile Money (online)' : 'Card (online)',
        academicYear: settings.academic_year, term: settings.term,
        receivedBy: null, receivedByName: 'Paid online (Paystack)', paystackReference: reference,
      })
    } else {
      const { rows: [n] } = await db.query('SELECT count(*)::int AS n FROM students WHERE school_id = $1 AND is_active', [op.school_id])
      await extendSubscription(db, op.school_id, {
        amount, pupils: n.n, method: 'online', reference, recordedByName: 'Paystack',
      })
    }
    await db.query(
      `INSERT INTO audit_log (school_id, actor_name, actor_role, action, target_type, target_id, details)
       VALUES ($1, 'Paystack', 'system', $2, $3, $4, $5)`,
      [op.school_id, op.purpose === 'fees' ? 'fees.online_payment' : 'billing.online_payment',
       op.purpose === 'fees' ? 'student' : 'school', op.student_id || op.school_id,
       JSON.stringify({ reference, amount, channel })]
    )
    log.info('online payment recorded', { reference, purpose: op.purpose, amount })
    return done()
  })
}
