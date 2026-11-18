import pg from 'pg'

const { Pool, types } = pg

// NUMERIC → JS number. pg returns NUMERIC as a string by default to avoid
// precision loss; scores here are small values with 2 decimals, so a number is exact enough.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)))

// DATE → keep the 'YYYY-MM-DD' string. The default turns it into a Date at local
// midnight, which can shift the day when the server and browser time zones differ.
types.setTypeParser(1082, (v) => v)

let pool

/**
 * One shared connection pool for the whole server.
 * DATABASE_URL example: postgres://user:pass@host:5432/schoolreport
 * Hosted databases usually need TLS: add ?sslmode=require (certificate checked),
 * or ?sslmode=no-verify only if the provider uses a private certificate authority.
 */
export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.')
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: parseInt(process.env.PG_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
    // An idle client can lose its connection (DB restart, network). Log it instead of crashing.
    pool.on('error', (err) => console.error('[DB] Idle client error:', err.message))
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
