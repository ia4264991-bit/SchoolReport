import crypto from 'node:crypto'

/**
 * Minimal structured logger.
 * Production: one JSON object per line on stdout (CloudWatch Logs can search fields).
 * Development: short readable lines.
 * Never log passwords, tokens, reset codes or request bodies.
 */
const JSON_LOGS = process.env.LOG_FORMAT ? process.env.LOG_FORMAT === 'json' : process.env.NODE_ENV === 'production'
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const MIN = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info

function write(level, msg, fields = {}) {
  if (LEVELS[level] < MIN || process.env.NODE_ENV === 'test') return
  if (JSON_LOGS) {
    const line = { time: new Date().toISOString(), level, msg, ...fields }
    if (fields.err instanceof Error) {
      line.err = { message: fields.err.message, code: fields.err.code, stack: fields.err.stack }
    }
    process.stdout.write(`${JSON.stringify(line)}\n`)
  } else {
    const extra = Object.entries(fields)
      .filter(([k]) => k !== 'err')
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ')
    const out = level === 'error' || level === 'warn' ? console.error : console.log
    out(`[${level}] ${msg}${extra ? ` ${extra}` : ''}`)
    if (fields.err?.stack) out(fields.err.stack)
  }
}

export const log = {
  debug: (msg, f) => write('debug', msg, f),
  info:  (msg, f) => write('info', msg, f),
  warn:  (msg, f) => write('warn', msg, f),
  error: (msg, f) => write('error', msg, f),
}

/**
 * Gives every request an id (CloudFront's own id when present, so a log line can be
 * matched to CloudFront logs), returns it in X-Request-Id, and logs one line per request.
 */
export function requestLogger(req, res, next) {
  const cf = req.headers['x-amz-cf-id']
  req.id = (typeof cf === 'string' && cf.length <= 100 ? cf : null) || crypto.randomUUID()
  res.setHeader('X-Request-Id', req.id)
  const start = process.hrtime.bigint()
  res.on('finish', () => {
    if (req.path === '/api/health/live') return // container health checks: too noisy
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
    write(level, 'request', {
      reqId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(ms),
      ip: req.ip,
      user: req.user?.id,
      school: req.user?.schoolId ?? undefined,
    })
  })
  next()
}
