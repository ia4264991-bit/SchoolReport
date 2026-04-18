import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import authRoutes from './routes/auth.js'
import User from './models/User.js'

const app = express()
const PORT = process.env.AUTH_PORT || 3001

app.use(cors())
app.use(express.json())

app.use('/', authRoutes)

app.get('/health', (_, res) => res.json({ service: 'auth', status: 'ok' }))

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('[Auth Service] MongoDB connected')

  // Seed superadmin only if none exists
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
    console.log(`[Auth Service] ✅ Superadmin seeded → ${process.env.SUPERADMIN_EMAIL || 'superadmin@schoolreport.ges'}`)
  }

  app.listen(PORT, () => console.log(`[Auth Service] ▶ http://localhost:${PORT}`))
}).catch(err => {
  console.error('[Auth Service] MongoDB connection failed:', err.message)
  process.exit(1)
})
