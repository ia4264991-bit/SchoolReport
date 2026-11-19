import { query } from '../../../shared/db.js'
import { HttpError } from '../../../shared/http.js'

/** Money in Ghana cedis: a number with at most 2 decimals. */
export function money(value, field, { allowNegative = false } = {}) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n === 0 || (!allowNegative && n < 0) || Math.abs(n) > 1_000_000) {
    throw new HttpError(400, `${field} must be an amount in cedis${allowNegative ? '' : ' above 0'}.`)
  }
  return Math.round(n * 100) / 100
}

export const cedis = (n) => Number(n || 0).toFixed(2)

/** Next receipt number of a school, e.g. "RCT-2026-00042". Call inside the payment's transaction. */
export async function nextReceiptNo(db, schoolId) {
  const { rows: [r] } = await db.query(
    `INSERT INTO school_counters (school_id, name, value) VALUES ($1, 'receipt', 1)
     ON CONFLICT (school_id, name) DO UPDATE SET value = school_counters.value + 1
     RETURNING value`,
    [schoolId]
  )
  return `RCT-${new Date().getUTCFullYear()}-${String(r.value).padStart(5, '0')}`
}

export const paymentToApi = (p, { staff = true } = {}) => ({
  _id: p.id,
  studentId: p.student_id,
  amount: p.amount,
  method: p.method,
  reference: p.reference,
  paidOn: p.paid_on,
  receiptNo: p.receipt_no,
  note: p.note,
  academicYear: p.academic_year,
  term: p.term,
  voided: Boolean(p.voided_at),
  ...(staff ? {
    receivedBy: p.received_by_name,
    voidedBy: p.voided_by_name || null,
    voidReason: p.void_reason || null,
  } : {}),
  createdAt: p.created_at,
})

/** A pupil's fee account: every charge and payment, and the balance (what is still owed). */
export async function feeStatement(schoolId, studentId, { staff = true } = {}) {
  const { rows: [st] } = await query(
    `SELECT s.id, s.full_name, s.class_id, s.guardian_name, s.is_active, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.id = $1 AND s.school_id = $2`,
    [studentId, schoolId]
  )
  if (!st) throw new HttpError(404, 'Pupil not found.')
  const [{ rows: charges }, { rows: payments }] = await Promise.all([
    query(
      `SELECT id, academic_year, term, description, amount, created_by_name, created_at FROM fee_charges
        WHERE school_id = $1 AND student_id = $2 ORDER BY created_at`,
      [schoolId, studentId]),
    query(
      `SELECT * FROM fee_payments WHERE school_id = $1 AND student_id = $2 ORDER BY paid_on, created_at`,
      [schoolId, studentId]),
  ])
  const totalCharged = charges.reduce((a, c) => a + c.amount, 0)
  const totalPaid = payments.filter((p) => !p.voided_at).reduce((a, p) => a + p.amount, 0)
  return {
    student: { _id: st.id, fullName: st.full_name, classId: st.class_id, className: st.class_name || '', guardianName: st.guardian_name },
    charges: charges.map((c) => ({
      _id: c.id, academicYear: c.academic_year, term: c.term, description: c.description, amount: c.amount,
      ...(staff ? { addedBy: c.created_by_name } : {}), createdAt: c.created_at,
    })),
    payments: payments.filter((p) => staff || !p.voided_at).map((p) => paymentToApi(p, { staff })),
    totalCharged: Math.round(totalCharged * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    balance: Math.round((totalCharged - totalPaid) * 100) / 100,
  }
}

/** Balances (owed) of many pupils: Map(studentId → balance). */
export async function balances(schoolId, studentIds) {
  if (!studentIds.length) return new Map()
  const { rows } = await query(
    `SELECT s.id,
            coalesce((SELECT sum(amount) FROM fee_charges c WHERE c.student_id = s.id), 0)
          - coalesce((SELECT sum(amount) FROM fee_payments p WHERE p.student_id = s.id AND p.voided_at IS NULL), 0) AS balance
       FROM students s WHERE s.school_id = $1 AND s.id = ANY($2::uuid[])`,
    [schoolId, studentIds]
  )
  return new Map(rows.map((r) => [r.id, Math.round(r.balance * 100) / 100]))
}

/**
 * Records a payment and returns its row. `db` must be a transaction client.
 */
export async function insertPayment(db, { schoolId, studentId, amount, method, reference = '', paidOn, note = '',
  academicYear, term, receivedBy = null, receivedByName = '', paystackReference = null }) {
  const receiptNo = await nextReceiptNo(db, schoolId)
  const { rows: [p] } = await db.query(
    `INSERT INTO fee_payments (school_id, student_id, amount, method, reference, paid_on, receipt_no, note,
                               academic_year, term, received_by, received_by_name, paystack_reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [schoolId, studentId, amount, method, reference, paidOn, receiptNo, note, academicYear, term,
     receivedBy, receivedByName, paystackReference]
  )
  return p
}
