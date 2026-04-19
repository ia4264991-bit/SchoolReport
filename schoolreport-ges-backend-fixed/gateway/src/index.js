import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import mongoose from 'mongoose'

// ── Auth module — three focused routers, one mount prefix each ──
import authRoutes      from '../services/auth/src/routes/auth.js'
import superadminRoutes from '../services/auth/src/routes/superadmin.js'
import userRoutes      from '../services/auth/src/routes/users.js'

// ── School, Students ────────────────────────────────────────────
import schoolRoutes   from '../services/school/src/routes/school.js'
import studentRoutes  from '../services/students/src/routes/students.js'

// ── Reports — two named exports, each gets its own prefix ───────
import { scoresRouter, reportsRouter } from '../services/reports/src/routes/reports.js'

// ── Superadmin seed model ───────────────────────────────────────
import User from '../services/auth/src/models/User.js'

const app  = express()
const PORT = process.env.PORT || process.env.GATEWAY_PORT || 3000

// ── Global middleware ───────────────────────────────────────────
app.use(cors())
app.use(express.json())
app.use(morgan('dev'))

// ── Health ──────────────────────────────────────────────────────
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', mode: 'modular-monolith', timestamp: new Date() })
})

// ════════════════════════════════════════════════════════════════
//  ROUTE MOUNTING
//  Rule: if mounted at '/api/auth' then router paths are /login, /me …
//        NOT /auth/login — that would produce /api/auth/auth/login ❌
// ════════════════════════════════════════════════════════════════

// Auth core: login, me, change-password, forgot-password, reset-password
app.use('/api/auth', authRoutes)

// Superadmin: schools CRUD + toggle
app.use('/api/superadmin', superadminRoutes)

// Users: list, create, update, delete, reset-password
app.use('/api/users', userRoutes)

// School settings, classes, subjects, max-marks, stats
app.use('/api/school', schoolRoutes)

// Students CRUD
app.use('/api/students', studentRoutes)

// Scores: get/post/put/delete by classId+term
app.use('/api/scores', scoresRouter)

// Reports: student reports, class reports, analytics
app.use('/api/reports', reportsRouter)

// ── 404 catch-all ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found.` })
})

// ── Connect DB → start server ───────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('[Server] ✅ MongoDB connected')

    // Seed superadmin on first boot
    const exists = await User.findOne({ role: 'superadmin' })
    if (!exists) {
      await User.create({
        fullName: process.env.SUPERADMIN_NAME     || 'Super Admin',
        email:    process.env.SUPERADMIN_EMAIL    || 'superadmin@schoolreport.ges',
        username: 'superadmin',
        password: process.env.SUPERADMIN_PASSWORD || 'SuperAdmin@2024!',
        role:     'superadmin',
        schoolId: null,
        mustChangePassword: false,
      })
      console.log(`[Server] ✅ Superadmin seeded → ${process.env.SUPERADMIN_EMAIL || 'superadmin@schoolreport.ges'}`)
    }

    app.listen(PORT, () => {
      console.log(`\n🚀 SchoolReport GES — Modular Monolith`)
      console.log(`   http://localhost:${PORT}/api\n`)
    })
  })
  .catch(err => {
    console.error('[Server] ❌ MongoDB connection failed:', err.message)
    process.exit(1)
  })
