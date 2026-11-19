import { Router } from 'express'
import { query } from '../../../../shared/db.js'
import { ah, HttpError, isUuid, requiredStr, idParam, termParam } from '../../../../shared/http.js'
import { audit } from '../../../../shared/audit.js'
import { sendSms, smsSegments, plainSms, smsConfigured, inBackground } from '../../../../shared/sms.js'
import { requireAuth, requireRole, requireSchool, assertClassAccess } from '../middleware/auth.js'
import { ensureSettings } from '../models/index.js'
import { smsSchoolName, parentLink, phonesOf, smsAllowanceLeft } from '../messaging.js'
import { buildClassReports } from '../../../reports/src/reportCards.js'

// Mounted at: /api/messages — notices to parents and SMS (admin, head)
const router = Router()
router.use(requireAuth, requireSchool, requireRole('admin', 'head'))

const sid = (req) => req.user.schoolId
const TITLE_MAX = 80
const BODY_MAX = 480

const ordinal = (n) => {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}

/** Distinct guardian phones of the active pupils of a class, or of the whole school. */
async function guardianPhones(schoolId, classId) {
  const { rows } = await query(
    `SELECT id, guardian_phone, guardian_phone2 FROM students
      WHERE school_id = $1 AND is_active AND ($2::uuid IS NULL OR class_id = $2)`,
    [schoolId, classId]
  )
  const phones = new Set()
  let without = 0
  for (const r of rows) {
    const p = phonesOf(r)
    if (!p.length) without++
    p.forEach((x) => phones.add(x))
  }
  return { phones: [...phones], pupils: rows.length, pupilsWithoutPhone: without }
}

/* GET /api/messages/usage */
router.get('/usage', ah(async (req, res) => {
  const settings = await ensureSettings(sid(req))
  const allowance = await smsAllowanceLeft(sid(req))
  const g = await guardianPhones(sid(req), null)
  res.json({
    smsConfigured: smsConfigured(),
    monthlyLimit: allowance.limit,
    usedThisMonth: allowance.used,
    leftThisMonth: allowance.left,
    absenceAlerts: settings.sms_absence_alerts,
    pupils: g.pupils,
    pupilsWithoutPhone: g.pupilsWithoutPhone,
    guardianPhones: g.phones.length,
  })
}))

/* GET /api/messages/notices */
router.get('/notices', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT n.*, c.name AS class_name FROM notices n LEFT JOIN classes c ON c.id = n.class_id
      WHERE n.school_id = $1 ORDER BY n.created_at DESC LIMIT 100`,
    [sid(req)]
  )
  res.json(rows.map((n) => ({
    _id: n.id, title: n.title, body: n.body, classId: n.class_id, className: n.class_name || '',
    sentBy: n.sent_by_name, smsRecipients: n.sms_recipients, createdAt: n.created_at,
  })))
}))

/* POST /api/messages/notices  { title, body, classId?, sendSms? }
   Shown to parents in the app; with sendSms also texted to every guardian phone. */
router.post('/notices', ah(async (req, res) => {
  const b = req.body || {}
  const title = requiredStr(b.title, 'Title', { max: TITLE_MAX })
  const body = requiredStr(b.body, 'Message', { max: BODY_MAX })
  let classId = null
  if (b.classId) {
    if (!isUuid(b.classId)) throw new HttpError(400, 'Class not found.')
    classId = (await assertClassAccess(req, b.classId)).id
  }
  const settings = await ensureSettings(sid(req))
  const message = plainSms(`${smsSchoolName(settings.school_name)}: ${title}. ${body}`)
  let recipients = []
  if (b.sendSms === true) {
    recipients = (await guardianPhones(sid(req), classId)).phones
    const cost = smsSegments(message) * recipients.length
    const { left } = await smsAllowanceLeft(sid(req))
    if (cost > left) {
      throw new HttpError(409, `This would use ${cost} SMS, but your school has ${left} left this month. Shorten the message, send to one class, or ask us to raise the limit.`)
    }
  }
  const { rows: [n] } = await query(
    `INSERT INTO notices (school_id, class_id, title, body, sent_by, sent_by_name, sms_recipients)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [sid(req), classId, title, body, req.user.id, req.user.fullName, recipients.length]
  )
  await audit(req, 'notice.send', { targetType: 'notice', targetId: n.id, details: { title, classId, smsRecipients: recipients.length } })
  if (recipients.length) {
    inBackground('notice sms', () => sendSms({ to: recipients, message, kind: 'notice', schoolId: sid(req) }))
  }
  res.status(201).json({
    _id: n.id, title, body, classId, smsRecipients: recipients.length,
    smsSegments: recipients.length ? smsSegments(message) : 0,
    message: recipients.length ? `Notice posted and sent to ${recipients.length} phone(s).` : 'Notice posted.',
  })
}))

/* DELETE /api/messages/notices/:id — remove from the parent app (SMS already sent stay sent) */
router.delete('/notices/:id', ah(async (req, res) => {
  const id = idParam(req.params.id, 'Notice')
  const del = await query('DELETE FROM notices WHERE id = $1 AND school_id = $2 RETURNING title', [id, sid(req)])
  if (!del.rowCount) throw new HttpError(404, 'Notice not found.')
  await audit(req, 'notice.delete', { targetType: 'notice', targetId: id, details: { title: del.rows[0].title } })
  res.json({ message: 'Notice removed.' })
}))

/** One results SMS per pupil (to each of their guardian phones). */
async function resultsMessages(req) {
  const cls = await assertClassAccess(req, req.params.classId)
  const term = termParam(req.params.term)
  const all = await buildClassReports({ schoolId: sid(req), classId: cls.id, term })
  const { rows: pupils } = await query(
    'SELECT id, guardian_phone, guardian_phone2 FROM students WHERE school_id = $1 AND class_id = $2 AND is_active',
    [sid(req), cls.id]
  )
  const phones = new Map(pupils.map((p) => [p.id, phonesOf(p)]))
  const school = smsSchoolName(all.school.name)
  const messages = []
  let without = 0
  for (const c of all.cards) {
    const to = phones.get(c.student._id) || []
    if (!to.length) { without++; continue }
    if (!c.subjectsScored) continue
    const att = c.attendance.total ? ` Attendance ${c.attendance.present}/${c.attendance.total}.` : ''
    messages.push({
      studentId: c.student._id,
      to,
      message: plainSms(`${school}: ${c.student.fullName}'s Term ${term} results: average ${c.average}%, `
        + `${ordinal(c.position)} of ${all.classSize}.${att} Full report: ${parentLink()} (sign in with this number).`),
    })
  }
  const cost = messages.reduce((a, m) => a + smsSegments(m.message) * m.to.length, 0)
  return { cls, term, messages, cost, pupilsWithoutPhone: without, academicYear: all.academicYear }
}

/* GET /api/messages/results/:classId/:term — what "send results by SMS" would send */
router.get('/results/:classId/:term', ah(async (req, res) => {
  const r = await resultsMessages(req)
  const { left } = await smsAllowanceLeft(sid(req))
  res.json({
    class: r.cls.name, term: r.term,
    pupils: r.messages.length, phones: r.messages.reduce((a, m) => a + m.to.length, 0),
    pupilsWithoutPhone: r.pupilsWithoutPhone, smsCost: r.cost, leftThisMonth: left,
    sample: r.messages[0]?.message || null,
  })
}))

/* POST /api/messages/results/:classId/:term — text each pupil's results to their parents */
router.post('/results/:classId/:term', ah(async (req, res) => {
  const r = await resultsMessages(req)
  if (!r.messages.length) throw new HttpError(400, 'No pupil in this class has both marks and a parent phone number.')
  const { left } = await smsAllowanceLeft(sid(req))
  if (r.cost > left) throw new HttpError(409, `This would use ${r.cost} SMS, but your school has ${left} left this month.`)
  await audit(req, 'results.sms', { targetType: 'class', targetId: r.cls.id, details: { class: r.cls.name, term: r.term, pupils: r.messages.length } })
  inBackground('results sms', async () => {
    for (const m of r.messages) {
      await sendSms({ to: m.to, message: m.message, kind: 'results', schoolId: sid(req), studentId: m.studentId })
    }
  })
  res.json({ message: `Sending results to the parents of ${r.messages.length} pupil(s).`, pupils: r.messages.length, smsCost: r.cost })
}))

export default router
