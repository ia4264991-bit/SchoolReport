import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

/** Columns safe to send to the browser (no password or reset-code fields). */
export const USER_COLUMNS = `id, full_name, email, phone, username, role, school_id, class_id, student_id, notes,
  is_active, must_change_password, created_at, updated_at`

// Roles an admin can create. Parent logins are created automatically from pupils' guardian phones.
export const SCHOOL_ROLES = ['admin', 'head', 'teacher', 'bursar', 'student']

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72 // bcrypt ignores anything past 72 bytes

export const hashPassword = (pw) => bcrypt.hash(pw, 12)

// Checked when the email is unknown, so a wrong email takes as long as a wrong password
// and response times do not reveal which emails are registered.
const DUMMY_HASH = '$2a$12$hlL8tkzG73Mq7U/43miYjO.x1M7ODziqwC9tl.dSNj8INwf8yAcSC'
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash || DUMMY_HASH)

/** Password-reset codes are stored as an HMAC tied to the user, never in plain text. */
export function hashOtp(userId, otp) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${userId}:${otp}`).digest('hex')
}

/** Unique, readable username. Logins use email; the username is only a display handle. */
export function makeUsername(email) {
  const prefix = email.split('@')[0].replace(/[^a-z0-9]/g, '').slice(0, 30) || 'user'
  return `${prefix}_${crypto.randomBytes(3).toString('hex')}`
}

/** DB row → the JSON shape the frontend expects. */
export function userToApi(row) {
  return {
    _id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone ?? null,
    username: row.username,
    role: row.role,
    schoolId: row.school_id,
    classId: row.class_id,
    studentId: row.student_id ?? null,
    notes: row.notes,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
