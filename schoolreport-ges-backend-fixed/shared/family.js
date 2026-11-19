import { query } from './db.js'
import { HttpError, isUuid } from './http.js'

/**
 * Pupils a parent login may see: the active pupils of the parent's school whose guardian
 * phone (first or second) is the parent's phone. Nothing else links a parent to a child,
 * so when the school changes or removes the number, access ends at once.
 */
export async function childrenOf(user) {
  if (user.role !== 'parent' || !user.phone) return []
  const { rows } = await query(
    `SELECT s.id, s.full_name, s.gender, s.class_id, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.school_id = $1 AND s.is_active AND (s.guardian_phone = $2 OR s.guardian_phone2 = $2)
      ORDER BY s.full_name`,
    [user.schoolId, user.phone]
  )
  return rows
}

/**
 * The pupil a student or parent login is asking about, or 404/403.
 *  - student login: always their own linked pupil
 *  - parent: one of their children (studentId required when they have several)
 */
export async function ownPupil(req, studentId) {
  if (req.user.role === 'student') {
    if (!req.user.studentId) throw new HttpError(404, 'Your login is not linked to a student yet. Ask your school admin.')
    return req.user.studentId
  }
  if (req.user.role === 'parent') {
    const kids = await childrenOf(req.user)
    if (!kids.length) throw new HttpError(404, 'No pupil at this school has your phone number. Ask the school to add it.')
    if (!studentId && kids.length === 1) return kids[0].id
    if (!isUuid(studentId) || !kids.some((k) => k.id === studentId)) throw new HttpError(404, 'Pupil not found.')
    return studentId
  }
  throw new HttpError(403, 'Only student and parent logins have a "my report" view.')
}
