import './env.js' // must stay first: loads .env before other modules read process.env

import { createApp } from './app.js'
import { seedSuperadmin } from './seed.js'
import { migrate } from '../../shared/migrate.js'
import { query, closePool } from '../../shared/db.js'

const PORT = process.env.PORT || 3000

function checkConfig() {
  const missing = ['DATABASE_URL', 'JWT_SECRET'].filter((k) => !process.env[k])
  if (missing.length) {
    console.error(`[Server] ❌ Missing environment variables: ${missing.join(', ')}. See .env.example.`)
    process.exit(1)
  }
  if (process.env.JWT_SECRET.length < 32) {
    console.warn('[Server] ⚠ JWT_SECRET is shorter than 32 characters; use a long random value in production.')
  }
}

async function start() {
  checkConfig()
  await query('SELECT 1')
  console.log('[Server] ✅ PostgreSQL connected')
  await migrate()
  await seedSuperadmin()

  const server = createApp().listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 SchoolReport GES running on port ${PORT}\n`)
  })

  // Render/Railway send SIGTERM on redeploy: finish open requests, then close the pool.
  const shutdown = (signal) => {
    console.log(`[Server] ${signal} received, shutting down…`)
    server.close(() => closePool().finally(() => process.exit(0)))
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

start().catch((err) => {
  console.error('[Server] ❌ Startup failed:', err.message)
  process.exit(1)
})
