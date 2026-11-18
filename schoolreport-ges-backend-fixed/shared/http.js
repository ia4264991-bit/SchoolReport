/**
 * Small HTTP helpers shared by every module.
 */
import { log } from './log.js'

/** Wraps an async route so a thrown error reaches the error handler (Express 4 does not do this itself). */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/** Throw this from a route to send a specific status and message. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v)

export const TERMS = ['1', '2', '3']

/** Returns a trimmed string, '' for null/undefined, or throws 400 for other types or overly long text. */
export function str(value, field, { max = 200 } = {}) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`)
  const v = value.trim()
  if (v.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`)
  return v
}

/** Like str() but the value must be present. */
export function requiredStr(value, field, opts) {
  const v = str(value, field, opts)
  if (!v) throw new HttpError(400, `${field} is required.`)
  return v
}

/** For :id route params: anything that is not a UUID cannot exist, so answer 404. */
export function idParam(value, what = 'Record') {
  if (!isUuid(value)) throw new HttpError(404, `${what} not found.`)
  return value
}

export function termParam(value) {
  if (!TERMS.includes(value)) throw new HttpError(400, 'Term must be 1, 2 or 3.')
  return value
}

/** 'YYYY-MM-DD' or empty → value or null. */
export function dateOrNull(value, field) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${field} must be a date (YYYY-MM-DD).`)
  }
  return value
}

/**
 * Central error handler. Turns known PostgreSQL errors into clear 4xx answers and
 * hides internal details of anything unexpected (logged on the server instead).
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message })
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body is not valid JSON.' })
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large.' })
  }
  switch (err.code) {
    case '23505': // unique_violation
      return res.status(409).json({ message: 'A record with that value already exists.' })
    case '23503': // foreign_key_violation
      return res.status(400).json({ message: 'A referenced record does not exist.' })
    case '23514': // check_violation
    case '22P02': // invalid_text_representation (e.g. a bad UUID)
    case '22001': // string too long
    case '22003': // numeric out of range
    case '22007': // invalid date
    case '22008': // date out of range
      return res.status(400).json({ message: 'One or more values are invalid.' })
  }
  log.error('unhandled error', { reqId: req.id, method: req.method, path: req.originalUrl.split('?')[0], err })
  // The id lets support find this exact error in the logs.
  res.status(500).json({ message: 'Server error. Please try again.', requestId: req.id })
}
