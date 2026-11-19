import { query } from '../../../shared/db.js'
import { today, addDays, addMonths } from '../../../shared/dates.js'

/**
 * Subscription price per term: GHS PRICE_PER_PUPIL_GHS for each pupil on the roll, at least
 * MIN_TERM_PRICE_GHS. One payment covers SUBSCRIPTION_TERM_MONTHS months. New schools get
 * TRIAL_DAYS free. All four are settings, so prices can change without new code.
 */
export function pricing() {
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d)
  return {
    currency: 'GHS',
    perPupil: num(process.env.PRICE_PER_PUPIL_GHS, 5),
    minimum: num(process.env.MIN_TERM_PRICE_GHS, 150),
    termMonths: num(process.env.SUBSCRIPTION_TERM_MONTHS, 4),
    trialDays: num(process.env.TRIAL_DAYS, 30),
  }
}

export async function quote(schoolId) {
  const { rows: [r] } = await query('SELECT count(*)::int AS n FROM students WHERE school_id = $1 AND is_active', [schoolId])
  const p = pricing()
  const amount = Math.max(p.minimum, Math.round(p.perPupil * r.n * 100) / 100)
  return { ...p, pupils: r.n, amount }
}

/**
 * Adds one paid period to a school. Paying early extends from the current end date, so no
 * paid days are lost. `db` must be a transaction client.
 */
export async function extendSubscription(db, schoolId, { amount, pupils, method, reference = null, note = '', recordedByName = '', months }) {
  const { rows: [s] } = await db.query('SELECT paid_until FROM schools WHERE id = $1 FOR UPDATE', [schoolId])
  const t = today()
  const start = s.paid_until && s.paid_until >= t ? addDays(s.paid_until, 1) : t
  const end = addDays(addMonths(start, months ?? pricing().termMonths), -1)
  await db.query("UPDATE schools SET plan = 'paid', paid_until = $2 WHERE id = $1", [schoolId, end])
  const { rows: [pay] } = await db.query(
    `INSERT INTO subscription_payments (school_id, amount, pupils, period_start, period_end, method, reference, note, recorded_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [schoolId, amount, pupils ?? 0, start, end, method, reference, note, recordedByName]
  )
  return pay
}

export const subscriptionPaymentToApi = (p) => ({
  _id: p.id, amount: p.amount, pupils: p.pupils, periodStart: p.period_start, periodEnd: p.period_end,
  method: p.method, reference: p.reference, note: p.note, recordedBy: p.recorded_by_name, createdAt: p.created_at,
})
