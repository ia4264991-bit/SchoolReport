import jwt from 'jsonwebtoken'

/**
 * Verifies Bearer JWT and attaches decoded payload to req.user
 * Each service validates tokens independently — gateway does NOT validate.
 * JWT payload: { id, email, role, schoolId, fullName }
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided.' })
  }
  try {
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Session expired. Please log in again.' })
    }
    res.status(401).json({ message: 'Invalid token.' })
  }
}

/**
 * Role-based access control
 * Usage: requireRole('admin') or requireRole('admin', 'head')
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated.' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Access denied. Requires role: [${roles.join(', ')}]. Your role: ${req.user.role}`
      })
    }
    next()
  }
}

/**
 * Ensures the authenticated user can only access their own school's data.
 * Superadmin bypasses this check.
 * Reads schoolId from: req.params, req.query, or req.body
 */
export function requireSameSchool(req, res, next) {
  if (req.user?.role === 'superadmin') return next() // superadmin sees all
  const schoolId = req.params.schoolId || req.query.schoolId || req.body.schoolId
  if (schoolId && schoolId.toString() !== req.user?.schoolId?.toString()) {
    return res.status(403).json({ message: 'Cross-school access denied.' })
  }
  next()
}

