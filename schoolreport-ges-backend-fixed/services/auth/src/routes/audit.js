import { Router } from 'express'
import { query } from '../../../../shared/db.js'
import { ah, HttpError, isUuid, str } from '../../../../shared/http.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()
// Mounted at: /api/audit

/**
 * GET /api/audit?limit=50&before=<id>&action=scores.&targetType=student&targetId=<id>[&schoolId= (superadmin)]
 * Newest first. Page with `before` = the last id of the previous page.
 */
router.get('/', requireAuth, requireRole('admin', 'superadmin'), ah(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)
  const where = []
  const params = []
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)) }

  if (req.user.role === 'superadmin') {
    if (req.query.schoolId) {
      if (!isUuid(req.query.schoolId)) throw new HttpError(400, 'Invalid school id.')
      add('school_id = ?', req.query.schoolId)
    }
  } else {
    add('school_id = ?', req.user.schoolId)
  }
  if (req.query.before) {
    const before = Number(req.query.before)
    if (!Number.isInteger(before) || before < 1) throw new HttpError(400, 'Invalid "before" value.')
    add('id < ?', before)
  }
  const action = str(req.query.action, 'Action', { max: 60 })
  if (action) add('starts_with(action, ?)', action) // prefix match, e.g. "scores." or "user."
  const targetType = str(req.query.targetType, 'Target type', { max: 30 })
  if (targetType) add('target_type = ?', targetType)
  const targetId = str(req.query.targetId, 'Target id', { max: 100 })
  if (targetId) add('target_id = ?', targetId)

  params.push(limit)
  const { rows } = await query(
    `SELECT id, at, school_id, actor_id, actor_name, actor_role, action, target_type, target_id, details, ip, request_id
       FROM audit_log
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC
      LIMIT $${params.length}`,
    params
  )
  res.json({
    entries: rows.map((r) => ({
      id: Number(r.id),
      at: r.at,
      schoolId: r.school_id,
      actor: { id: r.actor_id, name: r.actor_name, role: r.actor_role },
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      details: r.details,
      ip: r.ip,
      requestId: r.request_id,
    })),
    nextBefore: rows.length === limit ? Number(rows[rows.length - 1].id) : null,
  })
}))

export default router
