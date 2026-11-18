import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { query } from '../../shared/db.js'
import { ah, errorHandler } from '../../shared/http.js'

// ── Module routers ──────────────────────────────────────────────
import authRoutes       from '../../services/auth/src/routes/auth.js'
import superadminRoutes from '../../services/auth/src/routes/superadmin.js'
import userRoutes       from '../../services/auth/src/routes/users.js'
import schoolRoutes     from '../../services/school/src/routes/school.js'
import studentRoutes    from '../../services/students/src/routes/students.js'
import { scoresRouter, reportsRouter } from '../../services/reports/src/routes/reports.js'

/** Builds the Express app (no database connection or port yet — see index.js). */
export function createApp() {
  const app = express()
  const isProd = process.env.NODE_ENV === 'production'

  app.disable('x-powered-by')

  // Behind Render/Railway's proxy the client IP is in X-Forwarded-For; the login rate
  // limit needs the real IP. Only trust it when a proxy is actually in front.
  app.set('trust proxy', parseInt(process.env.TRUST_PROXY ?? (isProd ? '1' : '0'), 10))

  // CORS_ORIGINS="https://your-app.vercel.app,https://other.app" limits which sites may call
  // the API. Unset: any origin (fine for local development).
  const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  app.use(cors(origins.length ? { origin: origins } : undefined))

  app.use(express.json({ limit: '1mb' }))
  if (process.env.NODE_ENV !== 'test') app.use(morgan(isProd ? 'combined' : 'dev'))

  // ── Health (also checks the database answers) ─────────────────
  app.get('/api/health', ah(async (_req, res) => {
    await query('SELECT 1')
    res.json({ status: 'ok', database: 'postgresql', timestamp: new Date() })
  }))

  // ── Routes ────────────────────────────────────────────────────
  app.use('/api/auth',       authRoutes)
  app.use('/api/superadmin', superadminRoutes)
  app.use('/api/users',      userRoutes)
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
