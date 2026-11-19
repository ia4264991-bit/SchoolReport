import { query } from '../../../../shared/db.js'

/**
 * Ghana's academic year starts in September: from September 2026 it is "2026/2027",
 * before that "2025/2026".
 */
export function currentAcademicYear(now = new Date()) {
  const y = now.getFullYear()
  return now.getMonth() >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`
}

/* ─── Row → API JSON (keeps the field names the frontend already uses) ─── */

export const schoolToApi = (r) => ({
  _id: r.id,
  name: r.name,
  email: r.email,
  circuit: r.circuit,
  district: r.district,
  region: r.region,
  isActive: r.is_active,
  plan: r.plan,
  trialEndsAt: r.trial_ends_at ?? null,
  paidUntil: r.paid_until ?? null,
  phone: r.phone ?? null,
  signupSource: r.signup_source,
  smsMonthlyLimit: r.sms_monthly_limit,
  paystackSubaccount: r.paystack_subaccount ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export const settingsToApi = (r) => ({
  _id: r.school_id,
  schoolId: r.school_id,
  schoolName: r.school_name,
  circuit: r.circuit,
  district: r.district,
  region: r.region,
  headTeacher: r.head_teacher,
  academicYear: r.academic_year,
  term: r.term,
  nextTermDate: r.next_term_date || '',
  gradingScale: r.grading_scale,
  classScoreWeight: r.class_score_weight,
  smsAbsenceAlerts: r.sms_absence_alerts,
  // Fingerprint of the current logo (null = none); the app loads /school/logo?v=<this>.
  logoVersion: r.logo_version ?? null,
  updatedAt: r.updated_at,
})

export const classToApi = (r) => ({
  _id: r.id,
  schoolId: r.school_id,
  name: r.name,
  level: r.level,
  studentCount: r.student_count ?? 0,
  teacherName: r.teacher_name || '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export const subjectToApi = (r) => ({
  _id: r.id,
  schoolId: r.school_id,
  name: r.name,
  code: r.code,
  order: r.sort_order,
  maxClassScore: r.max_class_score,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

/**
 * Returns the school's settings row, creating it from the school record if missing.
 * Pass a transaction client as `db` to run inside a transaction.
 */
export async function ensureSettings(schoolId, db = { query }) {
  const found = await db.query('SELECT * FROM school_settings WHERE school_id = $1', [schoolId])
  if (found.rows[0]) return found.rows[0]
  const { rows } = await db.query(
    `INSERT INTO school_settings (school_id, school_name, circuit, district, region, academic_year)
     SELECT id, name, circuit, district, region, $2 FROM schools WHERE id = $1
     ON CONFLICT (school_id) DO UPDATE SET school_id = EXCLUDED.school_id
     RETURNING *`,
    [schoolId, currentAcademicYear()]
  )
  return rows[0]
}
