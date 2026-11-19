import { query } from '../../../shared/db.js'
import { log } from '../../../shared/log.js'
import { shortDay } from '../../../shared/dates.js'
import { sendSms, smsSegments, plainSms, monthlyUsage } from '../../../shared/sms.js'
import { ensureSettings } from './models/index.js'

/** The school name, kept short so messages stay within one SMS where possible. */
export function smsSchoolName(name) {
  const n = plainSms(name || 'Your school')
  return n.length > 32 ? `${n.slice(0, 31)}.` : n
}

export const parentLink = () => `${(process.env.FRONTEND_URL || 'https://schoolreport.online').replace(/^https?:\/\//, '')}/parent`

/** Guardian phones of a pupil row (one or two, without duplicates). */
export const phonesOf = (s) => [...new Set([s.guardian_phone, s.guardian_phone2].filter(Boolean))]

/** SMS segments the school may still send this month. */
export async function smsAllowanceLeft(schoolId) {
  const { rows: [school] } = await query('SELECT sms_monthly_limit FROM schools WHERE id = $1', [schoolId])
  const used = await monthlyUsage(schoolId)
  return { limit: school?.sms_monthly_limit ?? 0, used, left: Math.max(0, (school?.sms_monthly_limit ?? 0) - used) }
}

/**
 * "Your child was absent today" to each guardian phone of the given pupils. At most one
 * alert per pupil, phone and day, however often the register is saved. Runs in the
 * background after the register is saved.
 */
export async function sendAbsenceAlerts({ schoolId, studentIds, day }) {
  const settings = await ensureSettings(schoolId)
  const { rows: pupils } = await query(
    `SELECT s.id, s.full_name, s.guardian_phone, s.guardian_phone2 FROM students s
      WHERE s.school_id = $1 AND s.id = ANY($2::uuid[]) AND s.is_active
        AND (s.guardian_phone IS NOT NULL OR s.guardian_phone2 IS NOT NULL)`,
    [schoolId, studentIds]
  )
  if (!pupils.length) return
  const { rows: already } = await query(
    `SELECT student_id, to_phone FROM sms_messages
      WHERE kind = 'absence' AND status = 'sent' AND ref_day = $1 AND student_id = ANY($2::uuid[])`,
    [day, pupils.map((p) => p.id)]
  )
  const done = new Set(already.map((a) => `${a.student_id}|${a.to_phone}`))
  let { left } = await smsAllowanceLeft(schoolId)
  const school = smsSchoolName(settings.school_name)
  for (const p of pupils) {
    const to = phonesOf(p).filter((ph) => !done.has(`${p.id}|${ph}`))
    if (!to.length) continue
    const message = `${school}: ${p.full_name} was marked ABSENT today, ${shortDay(day)}. If this is a mistake, please contact the school.`
    const cost = smsSegments(plainSms(message)) * to.length
    if (cost > left) {
      log.warn('absence alerts stopped: monthly SMS limit reached', { schoolId })
      return
    }
    const r = await sendSms({ to, message, kind: 'absence', schoolId, studentId: p.id, refDay: day })
    left -= r.sent * r.segments
  }
}
