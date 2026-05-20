import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

// Load .env from project root (two levels up from gateway/src/)
// On Render/Railway/Vercel env vars are injected — this is a no-op there
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../.env') })

import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import mongoose from 'mongoose'

// ── Auth module routers ─────────────────────────────────────────
import authRoutes       from '../services/auth/src/routes/auth.js'
import superadminRoutes from '../services/auth/src/routes/superadmin.js'
import userRoutes       from '../services/auth/src/routes/users.js'

// ── School, Students ────────────────────────────────────────────
import schoolRoutes  from '../services/school/src/routes/school.js'
import studentRoutes from '../services/students/src/routes/students.js'

// ── Reports ─────────────────────────────────────────────────────
import { scoresRouter, reportsRouter } from '../services/reports/src/routes/reports.js'

// ── Superadmin seed model ────────────────────────────────────────
import User from '../services/auth/src/models/User.js'

const app  = express()
const PORT = process.env.PORT || 3000
const isProd = process.env.NODE_ENV === 'production'

// ── Global middleware ───────────────────────────────────────────
app.use(cors())
app.use(express.json())
app.use(morgan(isProd ? 'combined' : 'dev'))

// ── Health ──────────────────────────────────────────────────────
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', mode: 'modular-monolith', timestamp: new Date() })
})

// ── Route mounting ──────────────────────────────────────────────
app.use('/api/auth',       authRoutes)
app.use('/api/superadmin', superadminRoutes)
app.use('/api/users',      userRoutes)
app.use('/api/school',     schoolRoutes)
app.use('/api/students',   studentRoutes)
app.use('/api/scores',     scoresRouter)
app.use('/api/reports',    reportsRouter)

// ── 404 ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found.` })
})

// ── Connect DB → start ──────────────────────────────────────────
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
      console.log(`[Server] ✅ Superadmin seeded → ${process.env.SUPERADMIN_EMAIL}`)
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 SchoolReport GES running on port ${PORT}\n`)
    })
  })
  .catch(err => {
    console.error('[Server] ❌ MongoDB connection failed:', err.message)
    process.exit(1)
  })
