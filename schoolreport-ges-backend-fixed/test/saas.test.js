// Running as a service: self sign-up with an email code, free trial, read-only after the
// trial (with a grace period), paying per term online or by hand, platform controls.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApi, startMockPaystack, paystackSignature, PAYSTACK_TEST_KEY } from './helpers.js'

let t
let paystack
const s = {}
const EMAIL = 'head@sunrise.test'
const addMonthsMinusDay = (months) => {
  const d = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  const want = d.getUTCDate()
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months)
  d.setUTCDate(Math.min(want, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()))
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

before(async () => {
  paystack = await startMockPaystack()
  t = await startApi({
    PAYSTACK_SECRET_KEY: PAYSTACK_TEST_KEY, PAYSTACK_API_BASE: paystack.url,
    PRICE_PER_PUPIL_GHS: '5', MIN_TERM_PRICE_GHS: '150', SUBSCRIPTION_TERM_MONTHS: '4', TRIAL_DAYS: '30',
  })
  ;({ admin: s.existingAdmin } = await t.newSchool('Existing'))
})

after(async () => { await t.close(); await paystack.close() })

const signupBody = (over = {}) => ({
  schoolName: 'Sunrise Academy', region: 'Ashanti', district: 'Kumasi Metro', adminName: 'Grace Mensah',
  email: EMAIL, phone: '0244555666', password: 'Sunrise#2026', acceptTerms: true, ...over,
})

test('sign-up checks its input', async () => {
  const start = (b) => t.api('POST', '/api/signup/start', { body: b })
  assert.equal((await start(signupBody({ acceptTerms: false }))).status, 400)
  assert.equal((await start(signupBody({ phone: '123' }))).status, 400)
  assert.equal((await start(signupBody({ password: 'short' }))).status, 400)
  assert.equal((await start(signupBody({ email: 'not-an-email' }))).status, 400)
  assert.equal((await start(signupBody({ schoolName: '' }))).status, 400)
  const taken = await start(signupBody({ email: 'admin@existing.test' }))
  assert.equal(taken.status, 409)
})

test('sign-up: email code → school on a free trial with classes and subjects ready', async () => {
  const st = await t.api('POST', '/api/signup/start', { body: signupBody() })
  assert.equal(st.status, 200, JSON.stringify(st.data))
  const mail = t.mailOutbox.filter((m) => m.kind === 'signup_code' && m.to === EMAIL).at(-1)
  assert.ok(mail, 'code emailed')
  const code = mail.subject.match(/^(\d{6})/)[1]
  const stored = await t.query('SELECT password_hash, code_hash FROM signup_requests WHERE email = $1', [EMAIL])
  assert.ok(stored.rows[0].password_hash.startsWith('$2'), 'password kept hashed')

  assert.equal((await t.api('POST', '/api/signup/verify', { body: { email: EMAIL, code: code === '000000' ? '111111' : '000000' } })).status, 400)
  const v = await t.api('POST', '/api/signup/verify', { body: { email: EMAIL, code } })
  assert.equal(v.status, 201, JSON.stringify(v.data))
  assert.equal(v.data.user.role, 'admin')
  assert.equal(v.data.mustChangePassword, false)
  s.admin = v.data.token
  s.schoolId = v.data.user.schoolId
  assert.equal((await t.api('POST', '/api/signup/verify', { body: { email: EMAIL, code } })).status, 400, 'code used up')

  // Signs in with the password chosen at sign-up.
  assert.equal((await t.api('POST', '/api/auth/login', { body: { email: EMAIL, password: 'Sunrise#2026' } })).status, 200)
  const classes = (await t.api('GET', '/api/school/classes', { token: s.admin })).data
  assert.deepEqual(classes.map((c) => c.name).sort(), ['Basic 1', 'Basic 2', 'Basic 3', 'Basic 4', 'Basic 5', 'Basic 6', 'KG 1', 'KG 2'])
  assert.equal((await t.api('GET', '/api/school/subjects', { token: s.admin })).data.length, 10)
  const settings = (await t.api('GET', '/api/school/settings', { token: s.admin })).data
  assert.deepEqual([settings.schoolName, settings.region, settings.gradingScale.preset], ['Sunrise Academy', 'Ashanti', 'nacca'])

  const bill = await t.api('GET', '/api/billing', { token: s.admin })
  assert.equal(bill.status, 200)
  assert.deepEqual([bill.data.plan, bill.data.status], ['trial', 'active'])
  assert.ok(bill.data.daysLeft >= 29 && bill.data.daysLeft <= 30)
  assert.deepEqual([bill.data.quote.pupils, bill.data.quote.amount], [0, 150], 'minimum price')
  assert.equal(bill.data.onlinePayment, true)
})

test('after the trial and grace period the school is read-only until it pays', async () => {
  const cls = (await t.api('GET', '/api/school/classes', { token: s.admin })).data[0]._id
  // Within the grace period: still works, with a warning status.
  await t.query("UPDATE schools SET trial_ends_at = now() - interval '3 days' WHERE id = $1", [s.schoolId])
  assert.equal((await t.api('GET', '/api/billing', { token: s.admin })).data.status, 'grace')
  assert.equal((await t.api('POST', '/api/students', { token: s.admin, body: { fullName: 'Pupil One', gender: 'F', classId: cls } })).status, 201)

  await t.query("UPDATE schools SET trial_ends_at = now() - interval '20 days' WHERE id = $1", [s.schoolId])
  const blocked = await t.api('POST', '/api/students', { token: s.admin, body: { fullName: 'Pupil Two', gender: 'M', classId: cls } })
  assert.equal(blocked.status, 402)
  assert.equal(blocked.data.code, 'subscription_ended')
  assert.equal((await t.api('GET', `/api/students?classId=${cls}`, { token: s.admin })).status, 200, 'can still view')
  assert.equal((await t.api('GET', `/api/reports/cards/${cls}/1`, { token: s.admin })).status, 200, 'and print')
  const bill = await t.api('GET', '/api/billing', { token: s.admin })
  assert.equal(bill.data.status, 'locked')
  assert.deepEqual([bill.data.quote.pupils, bill.data.quote.amount], [1, 150])
})

test('paying online unlocks the school for a term; paying again extends it', async () => {
  const pay = await t.api('POST', '/api/billing/pay', { token: s.admin })
  assert.equal(pay.status, 200, JSON.stringify(pay.data))
  const sent = paystack.initialized.get(pay.data.reference)
  assert.deepEqual([sent.amount, sent.email, sent.subaccount], [15000, EMAIL, undefined], "the platform's own account")

  const v = await t.api('GET', `/api/payments/paystack/verify/${pay.data.reference}`, { token: s.admin })
  assert.equal(v.status, 200, JSON.stringify(v.data))
  assert.equal(v.data.status, 'success')
  assert.equal(v.data.paidUntil, addMonthsMinusDay(4))
  const bill = (await t.api('GET', '/api/billing', { token: s.admin })).data
  assert.deepEqual([bill.plan, bill.status, bill.history.length], ['paid', 'active', 1])
  const cls = (await t.api('GET', '/api/school/classes', { token: s.admin })).data[0]._id
  assert.equal((await t.api('POST', '/api/students', { token: s.admin, body: { fullName: 'Pupil Two', gender: 'M', classId: cls } })).status, 201)

  // Paying early adds a term after the current one (through the webhook this time).
  const pay2 = await t.api('POST', '/api/billing/pay', { token: s.admin })
  const raw = JSON.stringify({ event: 'charge.success', data: { reference: pay2.data.reference } })
  assert.equal((await t.api('POST', '/api/payments/paystack/webhook', { rawBody: raw, headers: { 'x-paystack-signature': paystackSignature(raw) } })).status, 200)
  const after2 = (await t.api('GET', '/api/billing', { token: s.admin })).data
  assert.equal(after2.history.length, 2)
  assert.ok(after2.paidUntil > bill.paidUntil)
  assert.equal(after2.history[0].periodStart > bill.paidUntil, true)
})

test('the platform sees every school and can change plans or record a payment', async () => {
  const list = await t.api('GET', '/api/superadmin/schools', { token: t.root })
  const sunrise = list.data.find((x) => x._id === s.schoolId)
  assert.deepEqual([sunrise.plan, sunrise.signupSource, sunrise.pupils, sunrise.subscription.status], ['paid', 'self', 2, 'active'])
  const existing = list.data.find((x) => x.name === 'Existing School')
  assert.deepEqual([existing.plan, existing.subscription.status], ['complimentary', 'active'])

  assert.equal((await t.api('PUT', `/api/superadmin/schools/${s.schoolId}/billing`, { token: t.root, body: { plan: 'gold' } })).status, 400)
  const lock = await t.api('PUT', `/api/superadmin/schools/${s.schoolId}/billing`, { token: t.root, body: { plan: 'paid', paidUntil: '2020-01-01' } })
  assert.equal(lock.status, 200)
  assert.equal(lock.data.subscription.status, 'locked')
  const manual = await t.api('POST', `/api/superadmin/schools/${s.schoolId}/payments`, { token: t.root, body: { amount: 150, months: 4, reference: 'BANK-123', note: 'Paid at GCB' } })
  assert.equal(manual.status, 201, JSON.stringify(manual.data))
  assert.equal(manual.data.periodEnd, addMonthsMinusDay(4))
  assert.equal((await t.api('GET', '/api/billing', { token: s.admin })).data.status, 'active')
  assert.equal((await t.api('POST', `/api/superadmin/schools/${s.schoolId}/payments`, { token: s.admin, body: { amount: 1 } })).status, 403)
  assert.equal((await t.api('POST', '/api/billing/pay', { token: s.existingAdmin })).status, 200, 'complimentary schools may pay too')
})

test('no more than 3 sign-up codes an hour for one email', async () => {
  const body = signupBody({ email: 'busy@school.test', schoolName: 'Busy School' })
  for (let i = 0; i < 3; i++) assert.equal((await t.api('POST', '/api/signup/start', { body })).status, 200)
  assert.equal((await t.api('POST', '/api/signup/start', { body })).status, 429)
})
