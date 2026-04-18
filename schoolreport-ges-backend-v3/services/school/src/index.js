import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import schoolRoutes from './routes/school.js'

const app = express()
const PORT = process.env.SCHOOL_PORT || 3002

app.use(cors())
app.use(express.json())

app.use('/', schoolRoutes)
app.get('/health', (_, res) => res.json({ service: 'school', status: 'ok' }))

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('[School] MongoDB connected')
  app.listen(PORT, () => console.log(`[School Service] running on port ${PORT}`))
}).catch(err => { console.error('[School] DB error:', err.message); process.exit(1) })
