import crypto from 'node:crypto'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { query } from '../../shared/db.js'
import { ah, errorHandler } from '../../shared/http.js'
import { requestLogger } from '../../shared/log.js'

// ── Module routers ──────────────────────────────────────────────
import authRoutes       from '../../services/auth/src/routes/auth.js'
import superadminRoutes from '../../services/auth/src/routes/superadmin.js'
import userRoutes       from '../../services/auth/src/routes/users.js'
import auditRoutes      from '../../services/auth/src/routes/audit.js'
import schoolRoutes     from '../../services/school/src/routes/school.js'
import studentRoutes    from '../../services/students/src/routes/students.js'
import { scoresRouter, reportsRouter } from '../../services/reports/src/routes/reports.js'

/**
 * Only CloudFront knows ORIGIN_VERIFY_SECRET (it adds it as a header on every request it
 * forwards). With it set, requests that reach the server some other way are refused, so the
 * CloudFront firewall can't be bypassed. The container's own health check is exempt.
 */
function originVerify(secret) {
  const expected = Buffer.from(secret)
  return (req, res, next) => {
    if (req.path === '/api/health/live') return next()
    const got = Buffer.from(String(req.headers['x-origin-verify'] || ''))
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
      return res.status(403).json({ message: 'Forbidden.' })
    }
    next()
  }
}

/** Builds the Express app (no database connection or port yet — see index.js). */
export function createApp() {
  const app = express()
  const isProd = process.env.NODE_ENV === 'production'

  app.disable('x-powered-by')

  // Behind CloudFront the client IP is in X-Forwarded-For; the rate limits need the real IP.
  // Only trust it when a proxy is actually in front (TRUST_PROXY = number of proxies).
  app.set('trust proxy', parseInt(process.env.TRUST_PROXY ?? (isProd ? '1' : '0'), 10))

  app.use(requestLogger)

  if (process.env.ORIGIN_VERIFY_SECRET) app.use(originVerify(process.env.ORIGIN_VERIFY_SECRET))

  // Security headers. The API only returns JSON, so the strictest content policy fits.
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // the Vercel site reads these responses
  }))
  // Responses carry personal data (students, scores): never let browsers or proxies cache them.
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })

  // CORS_ORIGINS="https://your-app.vercel.app,https://other.app" limits which sites may call
  // the API. Unset: any origin (local development only — production refuses to start without it).
  const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  app.use(cors(origins.length ? { origin: origins, maxAge: 600 } : undefined))

  // Overall per-IP limit (login and password reset have their own, stricter one).
  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    limit: parseInt(process.env.API_RATE_LIMIT_MAX || '300', 10),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/health'),
    message: { message: 'Too many requests. Please slow down and try again in a minute.' },
  }))

  app.use(express.json({ limit: '1mb' }))

  // ── Health ────────────────────────────────────────────────────
  // live:  the process is up (container health check; no database call)
  // ready: the database answers too (CloudFront/monitoring)
  app.get('/api/health/live', (_req, res) => res.json({ status: 'ok' }))
  const ready = ah(async (_req, res) => {
    await query('SELECT 1')
    res.json({ status: 'ok', database: 'postgresql', version: process.env.APP_VERSION || 'dev', timestamp: new Date() })
  })
  app.get('/api/health', ready)
  app.get('/api/health/ready', ready)

  // ── Routes ────────────────────────────────────────────────────
  app.use('/api/auth',       authRoutes)
  app.use('/api/superadmin', superadminRoutes)
  app.use('/api/users',      userRoutes)
  app.use('/api/audit',      auditRoutes)
  app.use('/api/school',     schoolRoutes)
  app.use('/api/students',   studentRoutes)
  app.use('/api/scores',     scoresRouter)
  app.use('/api/reports',    reportsRouter)

  // ── 404 ───────────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({ message: `Route ${req.method} ${req.path} not found.` })
  })

  app.use(errorHandler)
  return app
}
