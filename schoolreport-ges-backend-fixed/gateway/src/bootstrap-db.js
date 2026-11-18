// One-time / idempotent database setup, run by the deploy script with the RDS *master* login:
//   creates the application role and database, or updates the role's password.
//
// Why: the app must not use the master user. RDS rotates the master password automatically
// (every 7 days), and the master user has far more rights than the app needs.
//
// Environment:
//   PGHOST, PGPORT, PGUSER, PGPASSWORD   master connection (database "postgres")
//   DATABASE_SSL_CA                       CA bundle for certificate checking
//   APP_DB_NAME, APP_DB_USER, APP_DB_PASSWORD
import { readFileSync } from 'node:fs'
import pg from 'pg'

const { APP_DB_NAME = 'schoolreport', APP_DB_USER = 'schoolreport_app', APP_DB_PASSWORD } = process.env
if (!APP_DB_PASSWORD) {
  console.error('APP_DB_PASSWORD is required')
  process.exit(1)
}
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(APP_DB_NAME) || !/^[a-z_][a-z0-9_]{0,62}$/.test(APP_DB_USER)) {
  console.error('APP_DB_NAME / APP_DB_USER must be simple lowercase identifiers')
  process.exit(1)
}

const client = new pg.Client({
  database: 'postgres',
  ssl: process.env.DATABASE_SSL_CA
    ? { ca: readFileSync(process.env.DATABASE_SSL_CA, 'utf8'), rejectUnauthorized: true }
    : undefined,
})

/** Builds a statement server-side with format(%I/%L), so names and the password are quoted safely. */
async function exec(template, ...args) {
  const placeholders = args.map((_, i) => `$${i + 1}::text`).join(', ')
  const { rows } = await client.query(`SELECT format('${template}', ${placeholders}) AS sql`, args)
  await client.query(rows[0].sql)
}

try {
  await client.connect()
  const role = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_DB_USER])
  if (role.rowCount) {
    await exec('ALTER ROLE %I WITH LOGIN PASSWORD %L', APP_DB_USER, APP_DB_PASSWORD)
    console.log(`role ${APP_DB_USER}: password synced`)
  } else {
    await exec('CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', APP_DB_USER, APP_DB_PASSWORD)
    console.log(`role ${APP_DB_USER}: created`)
  }
  // PostgreSQL 16+: the master may only make the role a database owner if it can SET ROLE to it.
  await exec('GRANT %I TO CURRENT_USER', APP_DB_USER)

  const db = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [APP_DB_NAME])
  if (!db.rowCount) {
    await exec('CREATE DATABASE %I OWNER %I', APP_DB_NAME, APP_DB_USER)
    console.log(`database ${APP_DB_NAME}: created`)
  } else {
    console.log(`database ${APP_DB_NAME}: exists`)
  }
  // Nobody else may connect to the school data by default.
  await exec('REVOKE ALL ON DATABASE %I FROM PUBLIC', APP_DB_NAME)
  await exec('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', APP_DB_NAME, APP_DB_USER)
} catch (err) {
  console.error('database bootstrap failed:', err.message)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
