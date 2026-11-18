import { readFileSync } from 'node:fs'
import pg from 'pg'
import { log } from './log.js'

const { Pool, types } = pg

// NUMERIC → JS number. pg returns NUMERIC as a string by default to avoid
// precision loss; scores here are small values with 2 decimals, so a number is exact enough.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)))

// DATE → keep the 'YYYY-MM-DD' string. The default turns it into a Date at local
// midnight, which can shift the day when the server and browser time zones differ.
types.setTypeParser(1082, (v) => v)

let pool

/** True when database connection settings are present. */
export const databaseConfigured = () => Boolean(process.env.DATABASE_URL || process.env.PGHOST)

/**
 * One shared connection pool for the whole server. Connection settings, either:
 *  - DATABASE_URL=postgres://user:pass@host:5432/schoolreport, or
 *  - the standard PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE variables (production:
 *    no URL-encoding problems with generated passwords).
 * TLS: DATABASE_SSL_CA=<path to CA bundle> turns on TLS with full certificate checking
 * (production on Amazon RDS: the RDS bundle shipped in certs/). Locally, leave it unset.
 */
export function getPool() {
  if (!pool) {
    if (!databaseConfigured()) throw new Error('Set DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE.')
    const config = {
      max: parseInt(process.env.PG_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Kill runaway queries instead of letting them hold a connection.
      statement_timeout: parseInt(process.env.PG_STATEMENT_TIMEOUT_MS || '15000', 10),
      application_name: 'schoolreport-api',
    }
    if (process.env.DATABASE_URL) config.connectionString = process.env.DATABASE_URL
    if (process.env.DATABASE_SSL_CA) {
      config.ssl = { ca: readFileSync(process.env.DATABASE_SSL_CA, 'utf8'), rejectUnauthorized: true }
    }
    pool = new Pool(config)
    // An idle client can lose its connection (DB restart, network). Log it instead of crashing.
    pool.on('error', (err) => log.error('database idle client error', { err }))
  }
  return pool
}

export const query = (text, params) => getPool().query(text, params)

/** Runs fn(client) inside BEGIN/COMMIT; rolls back if it throws. */
export async function withTransaction(fn) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function closePool() {
  if (pool) {
    const p = pool
    pool = undefined
    await p.end()
  }
}
