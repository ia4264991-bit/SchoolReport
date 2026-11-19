// Shared setup for the feature test files. Each file runs in its own process, wipes the
// test database, and starts the API on a random port.
//
//   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/schoolreport_test npm test
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'

export const NEW_PW = 'NewPassw0rd!'
export const PAYSTACK_TEST_KEY = 'sk_test_schoolreport_dummy'

export const todayStr = () => new Date().toISOString().slice(0, 10)
export const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

/** Waits until fn() is truthy (background jobs such as SMS run after the response). */
export async function eventually(fn, { timeout = 3000, step = 25 } = {}) {
  const end = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out waiting for a background job')
    await new Promise((r) => setTimeout(r, step))
  }
}

export async function startApi(env = {}) {
  const TEST_URL = process.env.TEST_DATABASE_URL
  if (!TEST_URL) throw new Error('Set TEST_DATABASE_URL to a throwaway database (its name must end in _test).')
  if (!new URL(TEST_URL).pathname.slice(1).endsWith('_test')) {
    throw new Error('Refusing to run: the TEST_DATABASE_URL database name must end in "_test" because it is wiped.')
  }
  Object.assign(process.env, {
    DATABASE_URL: TEST_URL,
    JWT_SECRET: `test-secret-${'x'.repeat(40)}`,
    NODE_ENV: 'test',
    AUTH_RATE_LIMIT_MAX: '1000',
    LOGIN_IP_FAIL_LIMIT: '1000',
    API_RATE_LIMIT_MAX: '100000',
    SIGNUP_RATE_LIMIT_MAX: '1000',
    SUPERADMIN_EMAIL: 'root@test.local',
    SUPERADMIN_PASSWORD: 'RootPass#12345',
    FRONTEND_URL: 'https://schoolreport.test',
    ...env,
  })
  for (const k of ['SMTP_USER', 'SMTP_PASS', 'SMS_PROVIDER', 'PAYSTACK_SECRET_KEY']) if (!(k in env)) delete process.env[k]
  console.warn = () => {}

  const { query, closePool } = await import('../shared/db.js')
  const { migrate } = await import('../shared/migrate.js')
  const { seedSuperadmin } = await import('../gateway/src/seed.js')
  const { createApp } = await import('../gateway/src/app.js')
  const { smsOutbox } = await import('../shared/sms.js')
  const { mailOutbox } = await import('../services/auth/src/utils/mailer.js')

  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await migrate({ log: () => {} })
  await seedSuperadmin({ log: () => {} })
  const server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`

  async function api(method, path, { token, body, headers = {}, rawBody } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = text }
    return { status: res.status, data, headers: res.headers }
  }

  async function firstLogin(email, tempPassword) {
    const r = await api('POST', '/api/auth/login', { body: { email, password: tempPassword } })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    const ch = await api('POST', '/api/auth/change-password', {
      token: r.data.token, body: { currentPassword: tempPassword, newPassword: NEW_PW },
    })
    assert.equal(ch.status, 200, JSON.stringify(ch.data))
    return ch.data.token
  }

  const root = await firstLogin('root@test.local', 'RootPass#12345')

  /** A school made by the platform (complimentary plan) and its admin's token. */
  async function newSchool(name) {
    const key = name.toLowerCase().replace(/[^a-z]/g, '')
    const c = await api('POST', '/api/superadmin/schools', {
      token: root,
      body: { schoolName: `${name} School`, schoolEmail: `${key}@school.test`, adminName: `${name} Admin`, adminEmail: `admin@${key}.test` },
    })
    assert.equal(c.status, 201, JSON.stringify(c.data))
    const admin = await firstLogin(`admin@${key}.test`, c.data.credentials.password)
    return { schoolId: c.data.school._id, admin }
  }

  /** Creates a staff login in the admin's school and returns its token. */
  async function newUser(adminToken, { fullName, email, role, classId }) {
    const r = await api('POST', '/api/users', { token: adminToken, body: { fullName, email, role, classId } })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    return { id: r.data.user._id, token: await firstLogin(email, r.data.credentials.password) }
  }

  async function newClass(adminToken, name) {
    const r = await api('POST', '/api/school/classes', { token: adminToken, body: { name } })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    return r.data._id
  }

  async function newPupil(token, body) {
    const r = await api('POST', '/api/students', { token, body: { gender: 'M', ...body } })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    return r.data
  }

  /** Parent sign-in by SMS code (read from the test SMS outbox). */
  async function parentLogin(phone, { schoolId } = {}) {
    const before = smsOutbox.length
    const rq = await api('POST', '/api/auth/parent/request-code', { body: { phone } })
    assert.equal(rq.status, 200, JSON.stringify(rq.data))
    const msg = smsOutbox.slice(before).find((m) => m.kind === 'login_code')
    assert.ok(msg, 'a sign-in code was sent by SMS')
    const code = msg.message.match(/\b(\d{6})\b/)[1]
    const v = await api('POST', '/api/auth/parent/verify', { body: { phone, code, schoolId } })
    assert.equal(v.status, 200, JSON.stringify(v.data))
    return { ...v.data, code }
  }

  async function close() {
    await new Promise((r) => server.close(r))
    await closePool()
  }

  return { api, query, root, base, firstLogin, newSchool, newUser, newClass, newPupil, parentLogin, smsOutbox, mailOutbox, close }
}

/**
 * A stand-in for Paystack's API: records initialize calls and answers verify calls.
 * setStatus / setAmount change what verify reports for a reference.
 */
export async function startMockPaystack() {
  const initialized = new Map()
  const overrides = new Map()
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.headers.authorization !== `Bearer ${PAYSTACK_TEST_KEY}`) return send(401, { status: false, message: 'Invalid key' })
      if (req.method === 'POST' && req.url === '/transaction/initialize') {
        const body = JSON.parse(raw)
        initialized.set(body.reference, body)
        return send(200, { status: true, data: { authorization_url: `https://checkout.paystack.test/${body.reference}`, reference: body.reference } })
      }
      const m = req.url.match(/^\/transaction\/verify\/(.+)$/)
      if (req.method === 'GET' && m) {
        const ref = decodeURIComponent(m[1])
        const init = initialized.get(ref)
        if (!init) return send(404, { status: false, message: 'Transaction reference not found' })
        const o = overrides.get(ref) || {}
        return send(200, { status: true, data: {
          reference: ref, status: o.status || 'success', amount: o.amount ?? init.amount,
          currency: init.currency, channel: 'mobile_money', id: 12345,
        } })
      }
      send(404, { status: false })
    })
  })
  server.listen(0)
  await new Promise((r) => server.once('listening', r))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    initialized,
    setStatus: (ref, status) => overrides.set(ref, { ...overrides.get(ref), status }),
    setAmount: (ref, amount) => overrides.set(ref, { ...overrides.get(ref), amount }),
    close: () => new Promise((r) => server.close(r)),
  }
}

/** Signs a webhook body the way Paystack does. */
export const paystackSignature = (rawBody) =>
  crypto.createHmac('sha512', PAYSTACK_TEST_KEY).update(rawBody).digest('hex')
