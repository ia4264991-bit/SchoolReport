// `npm run migrate` — applies pending database migrations without starting the server.
// (The server also runs them on startup.)
import './env.js'
import { migrate } from '../../shared/migrate.js'
import { closePool } from '../../shared/db.js'
import { log } from '../../shared/log.js'

try {
  await migrate({ log: (m) => log.info(m) })
  log.info('migrations up to date')
} catch (err) {
  log.error('migration failed', { err })
  process.exitCode = 1
} finally {
  await closePool()
}
