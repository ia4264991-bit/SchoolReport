import jwt from 'jsonwebtoken'
import { query } from './db.js'
import { ah, HttpError, isUuid } from './http.js'

export const JWT_ALGORITHM = 'HS256'

/**
 * `v` is the user's token_version: changing or resetting the password bumps it in the
 * database, so every token issued before that stops working.
 */
export function signToken(userId, tokenVersion) {
  return jwt.sign({ id: userId, v: tokenVersion }, process.env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
}

/**
 * Verifies the Bearer token, then loads the user fresh from the database, so that
 * deactivating a user or school, or changing a role or class, takes effect at once
 * instead of when the token expires.
 * Sets req.user = { id, email, role, schoolId, classId, fullName, mustChangePassword }.
 */
function authenticate({ allowPendingPasswordChange }) {
  return ah(async (req, res, next) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided.' })
    }

    let payload
    try {
      payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] })
    } catch (err) {
      const message = err.name === 'TokenExpiredError'
        ? 'Session expired. Please log in again.'
        : 'Invalid token.'
      return res.status(401).json({ message })
    }
    // Tokens from the old MongoDB version carry ObjectIds, not UUIDs: those users must log in again.
    if (!isUuid(payload?.id)) return res.status(401).json({ message: 'Invalid token.' })

    const { rows } = await query(
      `SELECT u.id, u.email, u.role, u.school_id, u.class_id, u.full_name, u.token_version,
              u.is_active, u.must_change_password, s.is_active AS school_active
         FROM users u
         LEFT JOIN schools s ON s.id = u.school_id
        WHERE u.id = $1`,
      [payload.id]
    )
    const u = rows[0]
    if (!u || !u.is_active) {
      return res.status(401).json({ message: 'Your account is no longer active.' })
    }
    if (payload.v !== u.token_version) {
      return res.status(401).json({ message: 'Your password was changed. Please log in again.' })
    }
    if (u.school_id && !u.school_active) {
      return res.status(401).json({ message: "Your school's account has been deactivated." })
    }
    if (u.must_change_password && !allowPendingPasswordChange) {
      return res.status(403).json({ message: 'You must change your password before continuing.' })
    }

    req.user = {
      id: u.id,
      email: u.email,
      role: u.role,
      schoolId: u.school_id,
      classId: u.class_id,
      fullName: u.full_name,
      mustChangePassword: u.must_change_password,
      tokenVersion: u.token_version,
    }
    next()
  })
}

/** Normal routes: a user who still has to change a temporary password is refused. */
export const requireAuth = authenticate({ allowPendingPasswordChange: false })

/** Only for /auth/me and /auth/change-password. */
export const requireAuthAllowPasswordChange = authenticate({ allowPendingPasswordChange: true })

/** Usage: requireRole('admin') or requireRole('admin', 'head') */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated.' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to do this.' })
    }
    next()
  }
}

/** Routes that only make sense inside a school (everything except the superadmin console). */
export function requireSchool(req, res, next) {
  if (!req.user?.schoolId) {
    return res.status(403).json({ message: 'This action needs a school account.' })
  }
  next()
}

/**
 * Checks that classId is a class of the caller's school and that the caller may use it:
 *  - teachers only their own assigned class
 *  - student logins are not linked to a student record yet, so they get no class data
 * Returns the class row.
 */
export async function assertClassAccess(req, classId) {
  if (req.user.role === 'student') throw new HttpError(403, 'Student accounts cannot view class records.')
  if (!isUuid(classId)) throw new HttpError(404, 'Class not found.')
  const { rows } = await query(
    'SELECT id, name, level FROM classes WHERE id = $1 AND school_id = $2',
    [classId, req.user.schoolId]
  )
  if (!rows[0]) throw new HttpError(404, 'Class not found.')
  if (req.user.role === 'teacher' && req.user.classId !== classId) {
    throw new HttpError(403, 'You can only access your assigned class.')
  }
  return rows[0]
}
