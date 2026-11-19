import { Router } from 'express'
import { query, withTransaction } from '../../../../shared/db.js'
import { ah, HttpError, isUuid, str, requiredStr, idParam, termParam, dateOrNull } from '../../../../shared/http.js'
import { audit } from '../../../../shared/audit.js'
import { today } from '../../../../shared/dates.js'
import { sendSms, smsSegments, plainSms, inBackground } from '../../../../shared/sms.js'
import { requireAuth, requireRole, requireSchool } from '../middleware/auth.js'
import { ensureSettings } from '../models/index.js'
import { money, cedis, feeStatement, balances, insertPayment, paymentToApi } from '../fees.js'
import { smsSchoolName, parentLink, phonesOf, smsAllowanceLeft } from '../messaging.js'

// Mounted at: /api/fees
//   admin, bursar: everything (voiding a payment and removing a charge: admin only)
//   head teacher:  can look, not change
const router = Router()
router.use(requireAuth, requireSchool, requireRole('admin', 'bursar', 'head'))
const canWrite = requireRole('admin', 'bursar')

const sid = (req) => req.user.schoolId
const METHODS = ['cash', 'momo', 'bank', 'cheque']

/** academicYear / term from the query or body, else the school's current ones. */
async function period(req, src = req.query) {
  const settings = await ensureSettings(sid(req))
  return {
    academicYear: src.academicYear ? str(src.academicYear, 'Academic year', { max: 20 }) : settings.academic_year,
    term: src.term ? termParam(String(src.term)) : settings.term,
    settings,
  }
}

async function classOrNull(req, classId) {
  if (classId === undefined || classId === null || classId === '') return null
  if (!isUuid(classId)) throw new HttpError(400, 'Class not found.')
  const { rows } = await query('SELECT id, name FROM classes WHERE id = $1 AND school_id = $2', [classId, sid(req)])
  if (!rows[0]) throw new HttpError(400, 'Class not found.')
  return rows[0]
}

async function activePupil(req, studentId) {
  if (!isUuid(studentId)) throw new HttpError(404, 'Pupil not found.')
  const { rows } = await query(
    'SELECT id, full_name, class_id FROM students WHERE id = $1 AND school_id = $2 AND is_active', [studentId, sid(req)]
  )
  if (!rows[0]) throw new HttpError(404, 'Pupil not found.')
  return rows[0]
}

const itemToApi = (r) => ({
  _id: r.id, academicYear: r.academic_year, term: r.term, name: r.name, amount: r.amount,
  classId: r.class_id, className: r.class_name || '', billed: r.billed ?? 0,
})

/* ── Fee items (what each term costs) ─────────────────────────────────────── */

/* GET /api/fees/items?academicYear=&term= */
router.get('/items', ah(async (req, res) => {
  const { academicYear, term } = await period(req)
  const { rows } = await query(
    `SELECT f.*, c.name AS class_name,
            (SELECT count(*) FROM fee_charges ch WHERE ch.fee_item_id = f.id)::int AS billed
       FROM fee_items f LEFT JOIN classes c ON c.id = f.class_id
      WHERE f.school_id = $1 AND f.academic_year = $2 AND f.term = $3
      ORDER BY c.name NULLS FIRST, f.name`,
    [sid(req), academicYear, term]
  )
  res.json({ academicYear, term, items: rows.map(itemToApi) })
}))

/* POST /api/fees/items { name, amount, classId?, academicYear?, term? } */
router.post('/items', canWrite, ah(async (req, res) => {
  const b = req.body || {}
  const { academicYear, term } = await period(req, b)
  const cls = await classOrNull(req, b.classId)
  const { rows: [r] } = await query(
    `INSERT INTO fee_items (school_id, academic_year, term, name, amount, class_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [sid(req), academicYear, term, requiredStr(b.name, 'Fee name', { max: 80 }), money(b.amount, 'Amount'), cls?.id ?? null]
  )
  await audit(req, 'fees.item_create', { targetType: 'fee_item', targetId: r.id, details: { name: r.name, amount: r.amount, class: cls?.name || 'all', academicYear, term } })
  res.status(201).json(itemToApi({ ...r, class_name: cls?.name }))
}))

/* PUT /api/fees/items/:id { name, amount, classId } — pupils already billed keep the old amount */
router.put('/items/:id', canWrite, ah(async (req, res) => {
  const id = idParam(req.params.id, 'Fee item')
  const b = req.body || {}
  const { rows: [old] } = await query('SELECT * FROM fee_items WHERE id = $1 AND school_id = $2', [id, sid(req)])
  if (!old) throw new HttpError(404, 'Fee item not found.')
  const cls = b.classId !== undefined ? await classOrNull(req, b.classId) : null
  const next = {
    name: b.name !== undefined ? requiredStr(b.name, 'Fee name', { max: 80 }) : old.name,
    amount: b.amount !== undefined ? money(b.amount, 'Amount') : old.amount,
    class_id: b.classId !== undefined ? (cls?.id ?? null) : old.class_id,
  }
  const { rows: [r] } = await query(
    'UPDATE fee_items SET name = $3, amount = $4, class_id = $5 WHERE id = $1 AND school_id = $2 RETURNING *',
    [id, sid(req), next.name, next.amount, next.class_id]
  )
  await audit(req, 'fees.item_update', { targetType: 'fee_item', targetId: id, details: { name: [old.name, r.name], amount: [old.amount, r.amount] } })
  res.json(itemToApi(r))
}))

/* DELETE /api/fees/items/:id — charges already on pupils' accounts stay */
router.delete('/items/:id', canWrite, ah(async (req, res) => {
  const id = idParam(req.params.id, 'Fee item')
  const del = await query('DELETE FROM fee_items WHERE id = $1 AND school_id = $2 RETURNING name, amount', [id, sid(req)])
  if (!del.rowCount) throw new HttpError(404, 'Fee item not found.')
  await audit(req, 'fees.item_delete', { targetType: 'fee_item', targetId: id, details: del.rows[0] })
  res.json({ message: 'Fee item removed. Pupils already billed keep the charge on their account.' })
}))

/* POST /api/fees/bill { academicYear?, term?, classId? }
   Puts the term's fee items on every active pupil's account (all classes, or one).
   Safe to repeat: a pupil is never billed twice for the same item, so after adding new
   pupils, billing again only charges them. */
router.post('/bill', canWrite, ah(async (req, res) => {
  const b = req.body || {}
  const { academicYear, term } = await period(req, b)
  const cls = await classOrNull(req, b.classId)
  const result = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO fee_charges (school_id, student_id, academic_year, term, fee_item_id, description, amount, created_by_name)
       SELECT f.school_id, s.id, f.academic_year, f.term, f.id, f.name, f.amount, $5
         FROM fee_items f
         JOIN students s ON s.school_id = f.school_id AND s.is_active AND s.class_id IS NOT NULL
                        AND (f.class_id IS NULL OR f.class_id = s.class_id)
        WHERE f.school_id = $1 AND f.academic_year = $2 AND f.term = $3
          AND ($4::uuid IS NULL OR s.class_id = $4)
       ON CONFLICT ON CONSTRAINT fee_charges_once_per_item DO NOTHING
       RETURNING student_id, amount`,
      [sid(req), academicYear, term, cls?.id ?? null, req.user.fullName]
    )
    const pupils = new Set(rows.map((r) => r.student_id)).size
    const total = rows.reduce((a, r) => a + r.amount, 0)
    if (rows.length) {
      await audit(req, 'fees.bill', { db, details: { academicYear, term, class: cls?.name || 'all', charges: rows.length, pupils, total } })
    }
    return { charges: rows.length, pupils, total: Math.round(total * 100) / 100 }
  })
  res.json({
    ...result,
    message: result.charges
      ? `Billed ${result.pupils} pupil(s): GHS ${cedis(result.total)} in total.`
      : 'Nothing new to bill: every pupil already has these fees on their account.',
  })
}))

/* POST /api/fees/charges { studentId, description, amount } — one-off charge or (negative) discount */
router.post('/charges', canWrite, ah(async (req, res) => {
  const b = req.body || {}
  const pupil = await activePupil(req, b.studentId)
  const { academicYear, term } = await period(req, b)
  const amount = money(b.amount, 'Amount', { allowNegative: true })
  const description = requiredStr(b.description, 'Description', { max: 120 })
  const { rows: [c] } = await query(
    `INSERT INTO fee_charges (school_id, student_id, academic_year, term, description, amount, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [sid(req), pupil.id, academicYear, term, description, amount, req.user.fullName]
  )
  await audit(req, 'fees.charge_add', { targetType: 'student', targetId: pupil.id, details: { pupil: pupil.full_name, description, amount } })
  res.status(201).json({ _id: c.id, description, amount, academicYear, term })
}))

/* DELETE /api/fees/charges/:id (admin) */
router.delete('/charges/:id', requireRole('admin'), ah(async (req, res) => {
  const id = idParam(req.params.id, 'Charge')
  const del = await query(
    'DELETE FROM fee_charges WHERE id = $1 AND school_id = $2 RETURNING student_id, description, amount', [id, sid(req)]
  )
  if (!del.rowCount) throw new HttpError(404, 'Charge not found.')
  await audit(req, 'fees.charge_remove', { targetType: 'student', targetId: del.rows[0].student_id, details: del.rows[0] })
  res.json({ message: 'Charge removed.' })
}))

/* ── Who owes what ──────────────────────────────────────────────────────── */

/* GET /api/fees/classes/:classId?academicYear=&term= */
router.get('/classes/:classId', ah(async (req, res) => {
  const cls = await classOrNull(req, req.params.classId)
  if (!cls) throw new HttpError(404, 'Class not found.')
  const { academicYear, term } = await period(req)
  const { rows } = await query(
    `SELECT s.id, s.full_name, s.guardian_name, s.guardian_phone, s.guardian_phone2,
            coalesce((SELECT sum(amount) FROM fee_charges c WHERE c.student_id = s.id AND c.academic_year = $3 AND c.term = $4), 0) AS term_charged,
            coalesce((SELECT sum(amount) FROM fee_payments p WHERE p.student_id = s.id AND p.voided_at IS NULL AND p.academic_year = $3 AND p.term = $4), 0) AS term_paid
       FROM students s WHERE s.school_id = $1 AND s.class_id = $2 AND s.is_active ORDER BY s.full_name`,
    [sid(req), cls.id, academicYear, term]
  )
  const bal = await balances(sid(req), rows.map((r) => r.id))
  const pupils = rows.map((r) => {
    const balance = bal.get(r.id) ?? 0
    return {
      _id: r.id, fullName: r.full_name, guardianName: r.guardian_name,
      hasPhone: Boolean(r.guardian_phone || r.guardian_phone2),
      termCharged: r.term_charged, termPaid: r.term_paid, balance,
      status: balance <= 0 ? 'paid' : r.term_paid > 0 ? 'part' : 'owing',
    }
  })
  const sum = (k) => Math.round(pupils.reduce((a, p) => a + p[k], 0) * 100) / 100
  res.json({
    academicYear, term, class: { _id: cls.id, name: cls.name }, pupils,
    totals: { termCharged: sum('termCharged'), termPaid: sum('termPaid'), owed: Math.round(pupils.reduce((a, p) => a + Math.max(0, p.balance), 0) * 100) / 100 },
  })
}))

/* GET /api/fees/students/:id — the pupil's whole fee account */
router.get('/students/:id', ah(async (req, res) => {
  res.json(await feeStatement(sid(req), idParam(req.params.id, 'Pupil')))
}))

/* GET /api/fees/summary?academicYear=&term= — per class and for the school */
router.get('/summary', ah(async (req, res) => {
  const { academicYear, term } = await period(req)
  const { rows } = await query(
    `SELECT c.id, c.name,
            (SELECT count(*) FROM students s WHERE s.class_id = c.id AND s.is_active)::int AS pupils,
            coalesce((SELECT sum(ch.amount) FROM fee_charges ch JOIN students s ON s.id = ch.student_id
                       WHERE s.class_id = c.id AND ch.academic_year = $2 AND ch.term = $3), 0) AS billed,
            coalesce((SELECT sum(p.amount) FROM fee_payments p JOIN students s ON s.id = p.student_id
                       WHERE s.class_id = c.id AND p.voided_at IS NULL AND p.academic_year = $2 AND p.term = $3), 0) AS collected
       FROM classes c WHERE c.school_id = $1 ORDER BY c.name`,
    [sid(req), academicYear, term]
  )
  const { rows: owedRows } = await query(
    `SELECT s.class_id, sum(greatest(b.balance, 0)) AS owed FROM (
       SELECT s.id,
              coalesce((SELECT sum(amount) FROM fee_charges c WHERE c.student_id = s.id), 0)
            - coalesce((SELECT sum(amount) FROM fee_payments p WHERE p.student_id = s.id AND p.voided_at IS NULL), 0) AS balance
         FROM students s WHERE s.school_id = $1 AND s.is_active) b
       JOIN students s ON s.id = b.id GROUP BY s.class_id`,
    [sid(req)]
  )
  const owed = new Map(owedRows.map((r) => [r.class_id, r.owed]))
  const { rows: [todayRow] } = await query(
    `SELECT coalesce(sum(amount), 0) AS total, count(*)::int AS n FROM fee_payments
      WHERE school_id = $1 AND voided_at IS NULL AND paid_on = $2`,
    [sid(req), today()]
  )
  const classes = rows.map((r) => ({
    classId: r.id, className: r.name, pupils: r.pupils, billed: r.billed, collected: r.collected,
    owed: Math.round((owed.get(r.id) || 0) * 100) / 100,
  }))
  const sum = (k) => Math.round(classes.reduce((a, c) => a + c[k], 0) * 100) / 100
  res.json({
    academicYear, term, classes,
    totals: { billed: sum('billed'), collected: sum('collected'), owed: sum('owed') },
    today: { collected: todayRow.total, payments: todayRow.n },
  })
}))

/* ── Payments and receipts ──────────────────────────────────────────────── */

/* POST /api/fees/payments { studentId, amount, method, reference?, paidOn?, note? } */
router.post('/payments', canWrite, ah(async (req, res) => {
  const b = req.body || {}
  const pupil = await activePupil(req, b.studentId)
  if (!METHODS.includes(b.method)) throw new HttpError(400, 'Choose how it was paid: cash, MoMo, bank or cheque.')
  const amount = money(b.amount, 'Amount')
  const paidOn = dateOrNull(b.paidOn, 'Date paid') || today()
  if (paidOn > today()) throw new HttpError(400, 'The payment date cannot be in the future.')
  const { academicYear, term } = await period(req, {})
  const payment = await withTransaction(async (db) => {
    const p = await insertPayment(db, {
      schoolId: sid(req), studentId: pupil.id, amount, method: b.method,
      reference: str(b.reference, 'Reference', { max: 80 }), paidOn, note: str(b.note, 'Note', { max: 200 }),
      academicYear, term, receivedBy: req.user.id, receivedByName: req.user.fullName,
    })
    await audit(req, 'fees.payment', { db, targetType: 'student', targetId: pupil.id, details: { pupil: pupil.full_name, amount, method: b.method, receiptNo: p.receipt_no } })
    return p
  })
  const balance = (await balances(sid(req), [pupil.id])).get(pupil.id)
  res.status(201).json({ payment: paymentToApi(payment), balance, message: `Receipt ${payment.receipt_no}: GHS ${cedis(amount)} received.` })
}))

/* GET /api/fees/payments?from=&to= — payments received in a date range (default: today) */
router.get('/payments', ah(async (req, res) => {
  const from = dateOrNull(req.query.from, 'From') || today()
  const to = dateOrNull(req.query.to, 'To') || from
  const { rows } = await query(
    `SELECT p.*, s.full_name, c.name AS class_name FROM fee_payments p
       JOIN students s ON s.id = p.student_id LEFT JOIN classes c ON c.id = s.class_id
      WHERE p.school_id = $1 AND p.paid_on BETWEEN $2 AND $3
      ORDER BY p.paid_on DESC, p.created_at DESC LIMIT 1000`,
    [sid(req), from, to]
  )
  const valid = rows.filter((r) => !r.voided_at)
  res.json({
    from, to,
    total: Math.round(valid.reduce((a, r) => a + r.amount, 0) * 100) / 100,
    byMethod: valid.reduce((acc, r) => ({ ...acc, [r.method]: Math.round(((acc[r.method] || 0) + r.amount) * 100) / 100 }), {}),
    payments: rows.map((r) => ({ ...paymentToApi(r), pupil: r.full_name, className: r.class_name || '' })),
  })
}))

/* GET /api/fees/payments/:id — receipt */
router.get('/payments/:id', ah(async (req, res) => {
  const id = idParam(req.params.id, 'Payment')
  const { rows: [p] } = await query(
    `SELECT p.*, s.full_name, s.guardian_name, c.name AS class_name FROM fee_payments p
       JOIN students s ON s.id = p.student_id LEFT JOIN classes c ON c.id = s.class_id
      WHERE p.id = $1 AND p.school_id = $2`,
    [id, sid(req)]
  )
  if (!p) throw new HttpError(404, 'Payment not found.')
  const balance = (await balances(sid(req), [p.student_id])).get(p.student_id)
  res.json({ ...paymentToApi(p), pupil: p.full_name, className: p.class_name || '', guardianName: p.guardian_name, balance })
}))

/* POST /api/fees/payments/:id/void { reason } (admin) — the receipt stays, marked void */
router.post('/payments/:id/void', requireRole('admin'), ah(async (req, res) => {
  const id = idParam(req.params.id, 'Payment')
  const reason = requiredStr(req.body?.reason, 'Reason', { max: 200 })
  const { rows: [p] } = await query(
    `UPDATE fee_payments SET voided_at = now(), voided_by_name = $3, void_reason = $4
      WHERE id = $1 AND school_id = $2 AND voided_at IS NULL RETURNING *`,
    [id, sid(req), req.user.fullName, reason]
  )
  if (!p) throw new HttpError(404, 'Payment not found or already voided.')
  await audit(req, 'fees.payment_void', { targetType: 'student', targetId: p.student_id, details: { receiptNo: p.receipt_no, amount: p.amount, reason } })
  res.json({ message: `Receipt ${p.receipt_no} voided.`, payment: paymentToApi(p) })
}))

/* ── Reminders ──────────────────────────────────────────────────────────── */

async function reminderMessages(req, classId) {
  const settings = await ensureSettings(sid(req))
  const { rows } = await query(
    `SELECT id, full_name, guardian_phone, guardian_phone2 FROM students
      WHERE school_id = $1 AND is_active AND ($2::uuid IS NULL OR class_id = $2)`,
    [sid(req), classId]
  )
  const bal = await balances(sid(req), rows.map((r) => r.id))
  const school = smsSchoolName(settings.school_name)
  const out = []
  for (const r of rows) {
    const b = bal.get(r.id) || 0
    const to = phonesOf(r)
    if (b <= 0 || !to.length) continue
    out.push({
      studentId: r.id, to,
      message: plainSms(`${school}: The school fees balance for ${r.full_name} is GHS ${cedis(b)}. Please pay at the school office, or see ${parentLink()}. Thank you.`),
    })
  }
  return out
}

/* GET /api/fees/reminders?classId= — preview */
router.get('/reminders', ah(async (req, res) => {
  const cls = await classOrNull(req, req.query.classId)
  const msgs = await reminderMessages(req, cls?.id ?? null)
  const { left } = await smsAllowanceLeft(sid(req))
  res.json({
    pupils: msgs.length, phones: msgs.reduce((a, m) => a + m.to.length, 0),
    smsCost: msgs.reduce((a, m) => a + smsSegments(m.message) * m.to.length, 0),
    leftThisMonth: left, sample: msgs[0]?.message || null,
  })
}))

/* POST /api/fees/reminders { classId? } — SMS parents of pupils who still owe */
router.post('/reminders', canWrite, ah(async (req, res) => {
  const cls = await classOrNull(req, req.body?.classId)
  const msgs = await reminderMessages(req, cls?.id ?? null)
  if (!msgs.length) throw new HttpError(400, 'No pupil with an unpaid balance has a parent phone number.')
  const cost = msgs.reduce((a, m) => a + smsSegments(m.message) * m.to.length, 0)
  const { left } = await smsAllowanceLeft(sid(req))
  if (cost > left) throw new HttpError(409, `This would use ${cost} SMS, but your school has ${left} left this month.`)
  await audit(req, 'fees.reminders', { details: { class: cls?.name || 'all', pupils: msgs.length, smsCost: cost } })
  inBackground('fee reminders', async () => {
    for (const m of msgs) await sendSms({ to: m.to, message: m.message, kind: 'fee_reminder', schoolId: sid(req), studentId: m.studentId })
  })
  res.json({ message: `Sending reminders to the parents of ${msgs.length} pupil(s).`, pupils: msgs.length, smsCost: cost })
}))

export default router
