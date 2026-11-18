import { query } from './db.js'

/**
 * Records who did what in audit_log.
 *
 *   await audit(req, 'user.update', { targetType: 'user', targetId: id, details: { role: ['teacher', 'head'] } })
 *
 * Pass `db` (a transaction client) to save the entry together with the change it describes.
 * `details` must never contain passwords, tokens or reset codes.
 */
export async function audit(req, action, { schoolId, targetType = null, targetId = null, details = {}, db, actor } = {}) {
  // `actor` stands in for req.user when nobody is signed in (e.g. a password reset by email code).
  const u = actor || req.user || {}
  await (db || { query }).query(
    `INSERT INTO audit_log (school_id, actor_id, actor_name, actor_role, action, target_type, target_id, details, ip, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      schoolId !== undefined ? schoolId : (u.schoolId ?? null),
      u.id ?? null,
      u.fullName ?? '',
      u.role ?? '',
      action,
      targetType,
      targetId == null ? null : String(targetId),
      JSON.stringify(details),
      req.ip ?? null,
      req.id ?? null,
    ]
  )
}

/** { field: [before, after] } for the fields that actually changed. */
export function changes(before, after) {
  const out = {}
  for (const [k, v] of Object.entries(after)) {
    if (before[k] !== v && !(before[k] == null && v == null)) out[k] = [before[k] ?? null, v ?? null]
  }
  return out
}
