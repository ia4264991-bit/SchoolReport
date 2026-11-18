// `npm run migrate` — applies pending database migrations without starting the server.
// (The server also runs them on startup.)
import './env.js'
import { migrate } from '../../shared/migrate.js'
import { closePool } from '../../shared/db.js'

try {
  await migrate()
  console.log('[DB] Migrations up to date.')
} catch (err) {
  console.error('[DB] ❌', err.message)
  process.exitCode = 1
} finally {
  await closePool()
}
