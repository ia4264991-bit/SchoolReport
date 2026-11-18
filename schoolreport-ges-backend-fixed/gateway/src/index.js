import './env.js' // must stay first: loads .env before other modules read process.env

import { createApp } from './app.js'
import { seedSuperadmin } from './seed.js'
import { migrate } from '../../shared/migrate.js'
import { query, closePool, databaseConfigured } from '../../shared/db.js'
import { log } from '../../shared/log.js'

const PORT = process.env.PORT || 3000
const isProd = process.env.NODE_ENV === 'production'

/** Refuse to start with settings that would be unsafe in production. */
function checkConfig() {
  const problems = []
  if (!databaseConfigured()) problems.push('DATABASE_URL (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) is not set')
  if (!process.env.JWT_SECRET) problems.push('JWT_SECRET is not set')
  if (isProd) {
    if (!process.env.DATABASE_SSL_CA && !/sslmode=(require|verify-ca|verify-full)/.test(process.env.DATABASE_URL || '')) {
      problems.push('the database connection must use TLS in production (set DATABASE_SSL_CA)')
    }
    if ((process.env.JWT_SECRET || '').length < 32) problems.push('JWT_SECRET must be at least 32 characters')
    if (!process.env.CORS_ORIGINS) problems.push('CORS_ORIGINS must list the frontend address(es)')
    if (!process.env.FRONTEND_URL) problems.push('FRONTEND_URL must be set (used in email links)')
  } else if ((process.env.JWT_SECRET || '').length < 32) {
    log.warn('JWT_SECRET is shorter than 32 characters; production will refuse it')
  }
  if (problems.length) {
    log.error('invalid configuration — see .env.example', { problems })
    process.exit(1)
  }
}

async function start() {
  checkConfig()
  await query('SELECT 1')
  log.info('database connected')
  await migrate({ log: (m) => log.info(m) })
  await seedSuperadmin({ log: (m) => log.info(m) })

  const server = createApp().listen(PORT, '0.0.0.0', () => {
    log.info('server listening', { port: Number(PORT), env: process.env.NODE_ENV || 'development', version: process.env.APP_VERSION || 'dev' })
  })
  // Slightly above CloudFront's keep-alive, so idle connections are closed by CloudFront first.
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000

  // On redeploy the container gets SIGTERM: finish open requests, then close the pool.
  const shutdown = (signal) => {
    log.info('shutting down', { signal })
    server.close(() => closePool().finally(() => process.exit(0)))
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

process.on('unhandledRejection', (err) => log.error('unhandled promise rejection', { err }))

start().catch((err) => {
  log.error('startup failed', { err })
  process.exit(1)
})
