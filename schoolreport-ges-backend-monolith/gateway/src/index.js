import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import mongoose from 'mongoose'

// ── Internal module routers (no HTTP, no proxy) ──────────────
import authRoutes     from '../../services/auth/src/routes/auth.js'
import schoolRoutes   from '../../services/school/src/routes/school.js'
import studentRoutes  from '../../services/students/src/routes/students.js'
import reportRoutes   from '../../services/reports/src/routes/reports.js'

// ── Superadmin seed (was in auth service index.js) ───────────
import User from '../../services/auth/src/models/User.js'

const app  = express()
const PORT = process.env.PORT || process.env.GATEWAY_PORT || 3000

// ── Global middleware ─────────────────────────────────────────
app.use(cors())
app.use(express.json())
app.use(morgan('dev'))
app.get('/', (req, res) => {
  res.json({ status: 'SchoolReport API running 🚀' })
})

// ── Health ───────────────────────────────────────────────────
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', mode: 'modular-monolith', timestamp: new Date() })
})

// ── Mount all service routers ─────────────────────────────────
//
//  Auth routes register:
//    POST   /api/auth/login
//    POST   /api/auth/change-password
//    POST   /api/auth/forgot-password
//    POST   /api/auth/reset-password
//    GET    /api/auth/me
//    GET    /api/superadmin/schools
//    POST   /api/superadmin/schools
//    PUT    /api/superadmin/schools/:id/toggle
//    GET    /api/users
//    POST   /api/users
//    PUT    /api/users/:id
//    DELETE /api/users/:id
//    POST   /api/users/:id/reset-password
//
app.use('/api/auth',       authRoutes)
app.use('/api/superadmin', authRoutes)   // superadmin/* paths live in same router
app.use('/api/users',      authRoutes)

//  School routes register:
//    GET/PUT /api/school/settings
//    GET     /api/school/stats
//    CRUD    /api/school/classes
//    CRUD    /api/school/subjects
//    GET/PUT /api/school/max-marks
//    GET     /api/school/schools (superadmin)
//
app.use('/api/school', schoolRoutes)

//  Student routes register:
//    GET/POST/PUT/DELETE /api/students
//    POST                /api/students/bulk
//
app.use('/api/students', studentRoutes)

//  Reports routes register:
//    GET/POST/DELETE /api/scores/:classId/:term
//    POST            /api/scores/:classId/:term/bulk
//    PUT             /api/scores/:id
//    GET             /api/reports/student/:studentId/:term
//    GET             /api/reports/class/:classId/:term
//    GET             /api/reports/school/:schoolId/analytics
//
app.use('/api/scores',  reportRoutes)
app.use('/api/reports', reportRoutes)

// ── 404 catch-all ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found.` })
})

// ── Connect DB then start single server ───────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('[Server] ✅ MongoDB connected')

    // Seed superadmin on first boot (moved from auth service index)
    const superExists = await User.findOne({ role: 'superadmin' })
    if (!superExists) {
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
      console.log(`   Listening on http://localhost:${PORT}`)
      console.log(`   API base:   http://localhost:${PORT}/api\n`)
    })
  })
  .catch(err => {
    console.error('[Server] ❌ MongoDB connection failed:', err.message)
    process.exit(1)
  })

