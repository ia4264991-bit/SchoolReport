import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import proxy from 'express-http-proxy'

const app = express()
const PORT = process.env.GATEWAY_PORT || 3000

const AUTH_URL     = process.env.AUTH_SERVICE_URL     || 'http://localhost:3001'
const SCHOOL_URL   = process.env.SCHOOL_SERVICE_URL   || 'http://localhost:3002'
const STUDENTS_URL = process.env.STUDENTS_SERVICE_URL || 'http://localhost:3003'
const REPORTS_URL  = process.env.REPORTS_SERVICE_URL  || 'http://localhost:3004'

app.use(cors())
app.use(morgan('dev'))

/* ─── Health ─── */
app.get('/api/health', (_, res) => {
  res.json({
    gateway: 'ok',
    services: { auth: AUTH_URL, school: SCHOOL_URL, students: STUDENTS_URL, reports: REPORTS_URL }
  })
})

/* ══════════════════════════════════════════════════════════
   GATEWAY — proxy only, NO business logic, NO token validation
   All /api/<path> requests are forwarded to the correct service
══════════════════════════════════════════════════════════ */

// Auth core  →  /api/auth/*
app.use('/api/auth', proxy(AUTH_URL, {
  proxyReqPathResolver: (req) => req.url
}))

// Superadmin  →  /api/superadmin/*  (handled inside auth service)
app.use('/api/superadmin', proxy(AUTH_URL, {
  proxyReqPathResolver: (req) => `/superadmin${req.url}`
}))

// Users  →  /api/users/*
app.use('/api/users', proxy(AUTH_URL, {
  proxyReqPathResolver: (req) => `/users${req.url}`
}))

// School  →  /api/school/*
app.use('/api/school', proxy(SCHOOL_URL, {
  proxyReqPathResolver: (req) => req.url
}))

// Students  →  /api/students/*
app.use('/api/students', proxy(STUDENTS_URL, {
  proxyReqPathResolver: (req) => req.url
}))

// Scores  →  /api/scores/*
app.use('/api/scores', proxy(REPORTS_URL, {
  proxyReqPathResolver: (req) => `/scores${req.url}`
}))

// Reports  →  /api/reports/*
app.use('/api/reports', proxy(REPORTS_URL, {
  proxyReqPathResolver: (req) => `/reports${req.url}`
}))

/* ─── 404 catch-all ─── */
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found.` })
})

app.listen(PORT, () => {
  console.log(`\n🚀 API Gateway running on http://localhost:${PORT}`)
  console.log(`   → Auth        → ${AUTH_URL}`)
  console.log(`   → SuperAdmin  → ${AUTH_URL} (via /superadmin)`)
  console.log(`   → School      → ${SCHOOL_URL}`)
  console.log(`   → Students    → ${STUDENTS_URL}`)
  console.log(`   → Reports     → ${REPORTS_URL}\n`)
})
