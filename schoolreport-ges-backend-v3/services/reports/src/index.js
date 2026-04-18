import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import reportRoutes from './routes/reports.js'

const app = express()
const PORT = process.env.REPORTS_PORT || 3004

app.use(cors())
app.use(express.json())

app.use('/', reportRoutes)
app.get('/health', (_, res) => res.json({ service: 'reports', status: 'ok' }))

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('[Reports] MongoDB connected')
  app.listen(PORT, () => console.log(`[Reports Service] running on port ${PORT}`))
}).catch(err => { console.error('[Reports] DB error:', err.message); process.exit(1) })
