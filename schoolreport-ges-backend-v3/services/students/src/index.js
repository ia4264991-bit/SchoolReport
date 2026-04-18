import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import studentRoutes from './routes/students.js'

const app = express()
const PORT = process.env.STUDENTS_PORT || 3003

app.use(cors())
app.use(express.json())

app.use('/', studentRoutes)
app.get('/health', (_, res) => res.json({ service: 'students', status: 'ok' }))

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('[Students] MongoDB connected')
  app.listen(PORT, () => console.log(`[Students Service] running on port ${PORT}`))
}).catch(err => { console.error('[Students] DB error:', err.message); process.exit(1) })
