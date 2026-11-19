import { Router } from 'express'
import { query, withTransaction } from '../../../../shared/db.js'
import { ah, HttpError, isUuid, str, termParam } from '../../../../shared/http.js'
import { audit } from '../../../../shared/audit.js'
import { today, addDays, isDay } from '../../../../shared/dates.js'
import { inBackground } from '../../../../shared/sms.js'
import { requireAuth, requireRole, requireSchool, assertClassAccess } from '../middleware/auth.js'
import { ensureSettings } from '../../../school/src/models/index.js'
import { sendAbsenceAlerts } from '../../../school/src/messaging.js'

// Mounted at: /api/attendance
// The class register, marked once a day: present or absent for every pupil.
//  - class teachers: their own class; a register can be taken for today or the past
//    7 days (forgotten days, phones that were offline) and corrected on the day it was taken
//  - head and admin: any class, any past day, any time; they can also delete a register
const router = Router()
router.use(requireAuth, requireSchool, requireRole('admin', 'head', 'teacher'))

const sid = (req) => req.user.schoolId
const STATUSES = ['present', 'absent']
const TEACHER_BACKFILL_DAYS = 7

function dayParam(v) {
  if (!isDay(v)) throw new HttpError(400, 'Day must be a date (YYYY-MM-DD).')
  if (v > today()) throw new HttpError(400, 'You cannot take the register for a future day.')
  return v
}

async function registerFor(classId, day, db = { query }) {
  const { rows } = await db.query(
    `SELECT id, academic_year, term, taken_by_name, created_at, updated_at,
            (created_at AT TIME ZONE 'UTC')::date::text AS taken_on
       FROM attendance_registers WHERE class_id = $1 AND day = $2`,
    [classId, day]
  )
  return rows[0] || null
}

/** Whether this user may create or change the register of `day`. */
function mayWrite(req, register, day) {
  if (req.user.role !== 'teacher') return true
  if (!register) return day >= addDays(today(), -TEACHER_BACKFILL_DAYS)
  return register.taken_on === today()
}

const registerToApi = (r) => r && ({
  takenBy: r.taken_by_name,
  takenAt: r.created_at,
  updatedAt: r.updated_at,
  academicYear: r.academic_year,
  term: r.term,
})

/* GET /api/attendance/overview?day=YYYY-MM-DD — every class's register for the day (admin, head) */
router.get('/overview', requireRole('admin', 'head'), ah(async (req, res) => {
  const day = req.query.day ? dayParam(String(req.query.day)) : today()
  const { rows } = await query(
    `SELECT c.id, c.name,
            (SELECT count(*) FROM students s WHERE s.class_id = c.id AND s.is_active)::int AS student_count,
            r.taken_by_name, r.created_at,
            (SELECT count(*) FROM attendance_marks m WHERE m.register_id = r.id AND m.status = 'present')::int AS present,
            (SELECT count(*) FROM attendance_marks m WHERE m.register_id = r.id AND m.status = 'absent')::int AS absent
       FROM classes c
       LEFT JOIN attendance_registers r ON r.class_id = c.id AND r.day = $2
      WHERE c.school_id = $1
      ORDER BY c.name`,
    [sid(req), day]
  )
  res.json({
    day,
    classes: rows.map((r) => ({
      classId: r.id,
      className: r.name,
      studentCount: r.student_count,
      taken: Boolean(r.created_at),
      takenBy: r.taken_by_name || '',
      takenAt: r.created_at,
      present: r.present,
      absent: r.absent,
    })),
  })
}))

/* GET /api/attendance/:classId/register?term=&academicYear= — the term's register as a grid */
router.get('/:classId/register', ah(async (req, res) => {
  const cls = await assertClassAccess(req, req.params.classId)
  const settings = await ensureSettings(sid(req))
  const term = req.query.term ? termParam(String(req.query.term)) : settings.term
  const academicYear = req.query.academicYear ? str(req.query.academicYear, 'Academic year', { max: 20 }) : settings.academic_year

  const { rows: days } = await query(
    `SELECT id, day FROM attendance_registers
      WHERE school_id = $1 AND class_id = $2 AND academic_year = $3 AND term = $4
      ORDER BY day`,
    [sid(req), cls.id, academicYear, term]
  )
  // Pupils on the class now, plus anyone who has marks in these registers (moved or removed since).
  const { rows: marks } = await query(
    `SELECT m.student_id, r.day, m.status
       FROM attendance_marks m JOIN attendance_registers r ON r.id = m.register_id
      WHERE r.school_id = $1 AND r.class_id = $2 AND r.academic_year = $3 AND r.term = $4`,
    [sid(req), cls.id, academicYear, term]
  )
  const { rows: students } = await query(
    `SELECT id, full_name, gender, is_active, class_id FROM students
      WHERE school_id = $1 AND ((class_id = $2 AND is_active) OR id = ANY($3::uuid[]))
      ORDER BY full_name`,
    [sid(req), cls.id, [...new Set(marks.map((m) => m.student_id))]]
  )
  const byStudent = new Map(students.map((s) => [s.id, { marks: {}, present: 0, absent: 0 }]))
  for (const m of marks) {
    const e = byStudent.get(m.student_id)
    if (!e) continue
    e.marks[m.day] = m.status === 'present' ? 'P' : 'A'
    if (m.status === 'present') e.present++; else e.absent++
  }
  res.json({
    academicYear,
    term,
    class: { _id: cls.id, name: cls.name, level: cls.level },
    days: days.map((d) => d.day),
    students: students.map((s) => {
      const e = byStudent.get(s.id)
      return {
        _id: s.id,
        fullName: s.full_name,
        gender: s.gender,
        current: s.is_active && s.class_id === cls.id,
        marks: e.marks,
        present: e.present,
        absent: e.absent,
        total: e.present + e.absent,
      }
    }),
  })
}))

/* GET /api/attendance/:classId?day=YYYY-MM-DD — one day's register with every pupil's mark */
router.get('/:classId', ah(async (req, res) => {
  const cls = await assertClassAccess(req, req.params.classId)
  const day = req.query.day ? dayParam(String(req.query.day)) : today()
  const register = await registerFor(cls.id, day)
  const { rows } = await query(
    `SELECT s.id, s.full_name, s.gender, m.status
       FROM students s
       LEFT JOIN attendance_marks m ON m.student_id = s.id AND m.register_id = $3
      WHERE s.school_id = $1 AND s.class_id = $2 AND s.is_active
      ORDER BY s.full_name`,
    [sid(req), cls.id, register?.id ?? null]
  )
  res.json({
    day,
    today: today(),
    class: { _id: cls.id, name: cls.name, level: cls.level },
    register: registerToApi(register),
    canEdit: mayWrite(req, register, day),
    students: rows.map((r) => ({ _id: r.id, fullName: r.full_name, gender: r.gender, status: r.status || null })),
  })
}))

/* PUT /api/attendance/:classId/:day  { marks: { studentId: 'present' | 'absent' } }
   Pupils left out keep their current mark (a phone that was offline may not know about a
   pupil added later). */
router.put('/:classId/:day', ah(async (req, res) => {
  const cls = await assertClassAccess(req, req.params.classId)
  const day = dayParam(req.params.day)
  const marks = req.body?.marks
  if (!marks || typeof marks !== 'object' || Array.isArray(marks)) {
    throw new HttpError(400, 'Send marks as { studentId: "present" | "absent" }.')
  }
  const entries = Object.entries(marks)
  if (!entries.length) throw new HttpError(400, 'Mark at least one pupil.')
  for (const [id, status] of entries) {
    if (!isUuid(id)) throw new HttpError(400, 'Unknown pupil in the register.')
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Each mark must be "present" or "absent".')
  }
  const { rows: pupils } = await query(
    'SELECT id, full_name FROM students WHERE school_id = $1 AND class_id = $2 AND is_active AND id = ANY($3::uuid[])',
    [sid(req), cls.id, entries.map(([id]) => id)]
  )
  const names = new Map(pupils.map((p) => [p.id, p.full_name]))
  const unknown = entries.filter(([id]) => !names.has(id)).length
  if (unknown) throw new HttpError(400, `${unknown} pupil(s) in this register are not in ${cls.name}. Reload the page and try again.`)

  const settings = await ensureSettings(sid(req))
  const result = await withTransaction(async (db) => {
    let register = await registerFor(cls.id, day, db)
    if (!mayWrite(req, register, day)) {
      throw new HttpError(403, register
        ? 'This register was taken on an earlier day. Ask the head teacher or admin to correct it.'
        : `Class teachers can take the register for the past ${TEACHER_BACKFILL_DAYS} days only. Ask the head teacher or admin.`)
    }
    const created = !register
    if (created) {
      const { rows } = await db.query(
        `INSERT INTO attendance_registers (school_id, class_id, day, academic_year, term, taken_by, taken_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT attendance_one_register_per_day DO NOTHING
         RETURNING id`,
        [sid(req), cls.id, day, settings.academic_year, settings.term, req.user.id, req.user.fullName]
      )
      // Two phones saved the same day at once: use the register the other one created.
      register = rows[0] ? { id: rows[0].id } : await registerFor(cls.id, day, db)
    } else {
      await db.query('UPDATE attendance_registers SET updated_at = now() WHERE id = $1', [register.id])
    }

    const { rows: before } = await db.query(
      'SELECT student_id, status FROM attendance_marks WHERE register_id = $1 FOR UPDATE',
      [register.id]
    )
    const old = new Map(before.map((m) => [m.student_id, m.status]))
    await db.query(
      `INSERT INTO attendance_marks (register_id, student_id, status)
       SELECT $1, u.student_id, u.status FROM unnest($2::uuid[], $3::text[]) AS u(student_id, status)
       ON CONFLICT (register_id, student_id) DO UPDATE SET status = EXCLUDED.status`,
      [register.id, entries.map(([id]) => id), entries.map(([, st]) => st)]
    )
    const changed = entries
      .filter(([id, st]) => old.has(id) && old.get(id) !== st)
      .map(([id, st]) => ({ studentId: id, name: names.get(id), from: old.get(id), to: st }))
    const newlyAbsent = entries.filter(([id, st]) => st === 'absent' && old.get(id) !== 'absent').map(([id]) => id)

    if (created || changed.length || entries.some(([id]) => !old.has(id))) {
      await audit(req, created ? 'attendance.take' : 'attendance.update', {
        db, targetType: 'class', targetId: cls.id,
        details: {
          class: cls.name, day,
          present: entries.filter(([, st]) => st === 'present').length,
          absent: entries.filter(([, st]) => st === 'absent').length,
          ...(changed.length ? { changed } : {}),
        },
      })
    }
    const { rows: [counts] } = await db.query(
      `SELECT count(*) FILTER (WHERE status = 'present')::int AS present,
              count(*) FILTER (WHERE status = 'absent')::int AS absent
         FROM attendance_marks WHERE register_id = $1`,
      [register.id]
    )
    return { created, newlyAbsent, counts }
  })

  // Parents of pupils marked absent today get an SMS, if the school turned that on.
  if (settings.sms_absence_alerts && day === today() && result.newlyAbsent.length) {
    inBackground('absence alerts', () => sendAbsenceAlerts({ schoolId: sid(req), studentIds: result.newlyAbsent, day }))
  }

  const total = (await query(
    'SELECT count(*)::int AS n FROM students WHERE school_id = $1 AND class_id = $2 AND is_active', [sid(req), cls.id]
  )).rows[0].n
  res.json({
    message: result.created ? 'Register saved.' : 'Register updated.',
    day,
    present: result.counts.present,
    absent: result.counts.absent,
    unmarked: Math.max(0, total - result.counts.present - result.counts.absent),
  })
}))

/* DELETE /api/attendance/:classId/:day — remove a register taken by mistake (admin, head) */
router.delete('/:classId/:day', requireRole('admin', 'head'), ah(async (req, res) => {
  const cls = await assertClassAccess(req, req.params.classId)
  const day = dayParam(req.params.day)
  const del = await query('DELETE FROM attendance_registers WHERE class_id = $1 AND day = $2 AND school_id = $3', [cls.id, day, sid(req)])
  if (!del.rowCount) throw new HttpError(404, 'No register was taken for that day.')
  await audit(req, 'attendance.delete', { targetType: 'class', targetId: cls.id, details: { class: cls.name, day } })
  res.json({ message: 'Register deleted.' })
}))

export default router

