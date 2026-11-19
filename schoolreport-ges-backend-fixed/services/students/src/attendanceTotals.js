import { query } from '../../../shared/db.js'

/**
 * Attendance totals per pupil for a term, across every register (a pupil who changed class
 * mid-term keeps the days from both). Returns Map(studentId → { present, total }).
 */
export async function termAttendance(schoolId, studentIds, academicYear, term) {
  if (!studentIds.length) return new Map()
  const { rows } = await query(
    `SELECT m.student_id,
            count(*) FILTER (WHERE m.status = 'present')::int AS present,
            count(*)::int AS total
       FROM attendance_marks m JOIN attendance_registers r ON r.id = m.register_id
      WHERE r.school_id = $1 AND r.academic_year = $2 AND r.term = $3 AND m.student_id = ANY($4::uuid[])
      GROUP BY m.student_id`,
    [schoolId, academicYear, term, studentIds]
  )
  return new Map(rows.map((r) => [r.student_id, { present: r.present, total: r.total }]))
}
