// School fees: items, billing, discounts, payments and receipts, voiding, who owes,
// roles, SMS reminders, and online payment by parents through (a stand-in for) Paystack.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApi, startMockPaystack, paystackSignature, PAYSTACK_TEST_KEY, eventually } from './helpers.js'

let t
let paystack
const s = {}
const year = new Date().getUTCFullYear()

before(async () => {
  paystack = await startMockPaystack()
  t = await startApi({ PAYSTACK_SECRET_KEY: PAYSTACK_TEST_KEY, PAYSTACK_API_BASE: paystack.url })
  ;({ schoolId: s.school, admin: s.admin } = await t.newSchool('Delta'))
  ;({ admin: s.adminB } = await t.newSchool('Echo'))
  s.c1 = await t.newClass(s.admin, 'Basic 1')
  s.c2 = await t.newClass(s.admin, 'Basic 2')
  s.bursar = (await t.newUser(s.admin, { fullName: 'Akua Bursar', email: 'bursar@delta.test', role: 'bursar' })).token
  s.head = (await t.newUser(s.admin, { fullName: 'Head Teacher', email: 'head@delta.test', role: 'head' })).token
  s.teacher = (await t.newUser(s.admin, { fullName: 'Class Teacher', email: 'teacher@delta.test', role: 'teacher', classId: s.c1 })).token
  s.a1 = (await t.newPupil(s.admin, { fullName: 'Ama One', gender: 'F', classId: s.c1 }))._id
  s.a2 = (await t.newPupil(s.admin, { fullName: 'Abu Two', classId: s.c1, guardianName: 'Mr Two', guardianPhone: '0244000002' }))._id
  s.b1 = (await t.newPupil(s.admin, { fullName: 'Bea Three', gender: 'F', classId: s.c2 }))._id
})

after(async () => { await t.close(); await paystack.close() })

const balanceOf = async (id) => (await t.api('GET', `/api/fees/students/${id}`, { token: s.admin })).data.balance

test('fee items and billing: per class or for all, never twice', async () => {
  const tuition = await t.api('POST', '/api/fees/items', { token: s.bursar, body: { name: 'Tuition', amount: '400' } })
  assert.equal(tuition.status, 201, JSON.stringify(tuition.data))
  assert.equal((await t.api('POST', '/api/fees/items', { token: s.admin, body: { name: 'PTA levy', amount: 20, classId: s.c1 } })).status, 201)
  assert.equal((await t.api('POST', '/api/fees/items', { token: s.admin, body: { name: 'Bad', amount: -5 } })).status, 400)
  assert.equal((await t.api('POST', '/api/fees/items', { token: s.admin, body: { name: 'Bad', amount: 10, classId: '00000000-0000-4000-8000-000000000000' } })).status, 400)
  assert.equal((await t.api('POST', '/api/fees/items', { token: s.teacher, body: { name: 'X', amount: 1 } })).status, 403)
  assert.equal((await t.api('POST', '/api/fees/items', { token: s.head, body: { name: 'X', amount: 1 } })).status, 403, 'head can look, not change')

  const bill = await t.api('POST', '/api/fees/bill', { token: s.bursar, body: {} })
  assert.equal(bill.status, 200, JSON.stringify(bill.data))
  assert.deepEqual([bill.data.pupils, bill.data.charges, bill.data.total], [3, 5, 1240]) // 2 × 420 + 400
  const again = await t.api('POST', '/api/fees/bill', { token: s.bursar, body: {} })
  assert.deepEqual([again.data.charges, again.data.total], [0, 0], 'billing twice adds nothing')

  s.a3 = (await t.newPupil(s.admin, { fullName: 'Late Joiner', classId: s.c1 }))._id
  const late = await t.api('POST', '/api/fees/bill', { token: s.bursar, body: { classId: s.c1 } })
  assert.deepEqual([late.data.pupils, late.data.total], [1, 420], 'only the new pupil')

  const items = await t.api('GET', '/api/fees/items', { token: s.head })
  assert.equal(items.data.items.find((i) => i.name === 'Tuition').billed, 4)
})

test('discounts, payments with numbered receipts, voiding and balances', async () => {
  assert.equal((await t.api('POST', '/api/fees/charges', { token: s.bursar, body: { studentId: s.a1, description: 'Scholarship', amount: -100 } })).status, 201)
  assert.equal(await balanceOf(s.a1), 320)

  const p1 = await t.api('POST', '/api/fees/payments', { token: s.bursar, body: { studentId: s.a1, amount: 200, method: 'cash' } })
  assert.equal(p1.status, 201, JSON.stringify(p1.data))
  assert.equal(p1.data.payment.receiptNo, `RCT-${year}-00001`)
  assert.equal(p1.data.balance, 120)
  const p2 = await t.api('POST', '/api/fees/payments', { token: s.admin, body: { studentId: s.a1, amount: '120.00', method: 'momo', reference: 'MP2611.1234' } })
  assert.equal(p2.data.payment.receiptNo, `RCT-${year}-00002`)
  assert.equal(p2.data.balance, 0)
  s.p2 = p2.data.payment._id

  for (const body of [
    { studentId: s.a1, amount: 10, method: 'bitcoin' },
    { studentId: s.a1, amount: 0, method: 'cash' },
    { studentId: s.a1, amount: 10, method: 'cash', paidOn: '2099-01-01' },
    { studentId: '00000000-0000-4000-8000-000000000000', amount: 10, method: 'cash' },
  ]) {
    const r = await t.api('POST', '/api/fees/payments', { token: s.bursar, body })
    assert.ok([400, 404].includes(r.status), JSON.stringify(body))
  }
  assert.equal((await t.api('POST', '/api/fees/payments', { token: s.head, body: { studentId: s.a1, amount: 5, method: 'cash' } })).status, 403)
  assert.equal((await t.api('POST', '/api/fees/payments', { token: s.adminB, body: { studentId: s.a1, amount: 5, method: 'cash' } })).status, 404, 'other school')

  const receipt = await t.api('GET', `/api/fees/payments/${s.p2}`, { token: s.bursar })
  assert.deepEqual([receipt.data.pupil, receipt.data.className, receipt.data.amount, receipt.data.receivedBy], ['Ama One', 'Basic 1', 120, 'Delta Admin'])

  assert.equal((await t.api('POST', `/api/fees/payments/${s.p2}/void`, { token: s.bursar, body: { reason: 'x' } })).status, 403, 'admin only')
  assert.equal((await t.api('POST', `/api/fees/payments/${s.p2}/void`, { token: s.admin, body: {} })).status, 400, 'reason needed')
  assert.equal((await t.api('POST', `/api/fees/payments/${s.p2}/void`, { token: s.admin, body: { reason: 'Recorded twice' } })).status, 200)
  assert.equal((await t.api('POST', `/api/fees/payments/${s.p2}/void`, { token: s.admin, body: { reason: 'again' } })).status, 404)
  assert.equal(await balanceOf(s.a1), 120)

  const st = (await t.api('GET', `/api/fees/students/${s.a1}`, { token: s.head })).data
  assert.deepEqual(st.charges.map((c) => c.amount).sort((a, b) => a - b), [-100, 20, 400])
  assert.deepEqual(st.payments.map((p) => [p.receiptNo, p.voided]), [[`RCT-${year}-00001`, false], [`RCT-${year}-00002`, true]])
  assert.deepEqual([st.totalCharged, st.totalPaid, st.balance], [320, 200, 120])
})

test('who owes: class list and school summary', async () => {
  const cl = await t.api('GET', `/api/fees/classes/${s.c1}`, { token: s.head })
  assert.equal(cl.status, 200, JSON.stringify(cl.data))
  const by = Object.fromEntries(cl.data.pupils.map((p) => [p.fullName, p]))
  assert.deepEqual([by['Ama One'].status, by['Ama One'].balance], ['part', 120])
  assert.deepEqual([by['Abu Two'].status, by['Abu Two'].balance, by['Abu Two'].hasPhone], ['owing', 420, true])

  const sum = await t.api('GET', '/api/fees/summary', { token: s.admin })
  assert.deepEqual(sum.data.totals, { billed: 1560, collected: 200, owed: 1360 })
  assert.deepEqual(sum.data.today, { collected: 200, payments: 1 })
  assert.equal((await t.api('GET', '/api/fees/summary', { token: s.teacher })).status, 403)

  const day = await t.api('GET', '/api/fees/payments', { token: s.bursar })
  assert.deepEqual([day.data.total, day.data.byMethod.cash, day.data.payments.length], [200, 200, 2])
})

test('SMS reminders go to parents of pupils who owe', async () => {
  const pre = await t.api('GET', '/api/fees/reminders', { token: s.bursar })
  assert.deepEqual([pre.data.pupils, pre.data.phones], [1, 1])
  assert.match(pre.data.sample, /balance for Abu Two is GHS 420\.00/)
  const before = t.smsOutbox.length
  assert.equal((await t.api('POST', '/api/fees/reminders', { token: s.bursar, body: {} })).status, 200)
  await eventually(() => t.smsOutbox.slice(before).some((m) => m.kind === 'fee_reminder' && m.to === '+233244000002'))
})

test('a parent pays online; the money goes to the school subaccount and is recorded once', async () => {
  const parent = await t.parentLogin('0244000002')
  s.parent = parent.token
  const st = await t.api('GET', `/api/parent/children/${s.a2}/fees`, { token: s.parent })
  assert.equal(st.status, 200)
  assert.equal(st.data.balance, 420)
  assert.equal(st.data.payments.every((p) => p.receivedBy === undefined), true, 'no staff names for parents')

  const noAcct = await t.api('POST', `/api/parent/children/${s.a2}/fees/pay`, { token: s.parent, body: { amount: 100 } })
  assert.equal(noAcct.status, 409, 'school has no Paystack subaccount yet')

  assert.equal((await t.api('PUT', `/api/superadmin/schools/${s.school}/billing`, { token: t.root, body: { paystackSubaccount: 'bad' } })).status, 400)
  assert.equal((await t.api('PUT', `/api/superadmin/schools/${s.school}/billing`, { token: t.root, body: { paystackSubaccount: 'ACCT_delta123' } })).status, 200)
  assert.equal((await t.api('GET', '/api/parent/children', { token: s.parent })).data.onlinePayment, true)

  // The school admin can turn online payment off (pay at the office only) and on again.
  assert.equal((await t.api('PUT', '/api/school/settings', { token: s.head, body: { onlineFeePayments: false } })).status, 403, 'admin only')
  const off = await t.api('PUT', '/api/school/settings', { token: s.admin, body: { onlineFeePayments: false } })
  assert.equal(off.status, 200)
  assert.equal(off.data.onlineFeePayments, false)
  assert.equal((await t.api('GET', '/api/parent/children', { token: s.parent })).data.onlinePayment, false)
  const refused = await t.api('POST', `/api/parent/children/${s.a2}/fees/pay`, { token: s.parent, body: { amount: 100 } })
  assert.equal(refused.status, 409)
  assert.match(refused.data.message, /school office/)
  assert.equal((await t.api('PUT', '/api/school/settings', { token: s.admin, body: { onlineFeePayments: true } })).status, 200)

  const pay = await t.api('POST', `/api/parent/children/${s.a2}/fees/pay`, { token: s.parent, body: { amount: 100 } })
  assert.equal(pay.status, 200, JSON.stringify(pay.data))
  assert.match(pay.data.authorizationUrl, /^https:\/\/checkout\.paystack\.test\//)
  const sent = paystack.initialized.get(pay.data.reference)
  assert.deepEqual([sent.amount, sent.currency, sent.subaccount, sent.bearer], [10000, 'GHS', 'ACCT_delta123', 'subaccount'])
  assert.deepEqual(sent.channels, ['mobile_money', 'card'])

  // Someone else cannot ask about this payment.
  assert.equal((await t.api('GET', `/api/payments/paystack/verify/${pay.data.reference}`, { token: s.admin })).status, 404)
  const v = await t.api('GET', `/api/payments/paystack/verify/${pay.data.reference}`, { token: s.parent })
  assert.equal(v.status, 200, JSON.stringify(v.data))
  assert.equal(v.data.status, 'success')
  assert.match(v.data.receiptNo, /^RCT-\d{4}-\d{5}$/)
  assert.equal(await balanceOf(s.a2), 320)

  // The webhook for the same payment, and a second verify, change nothing.
  const raw = JSON.stringify({ event: 'charge.success', data: { reference: pay.data.reference } })
  const bad = await t.api('POST', '/api/payments/paystack/webhook', { rawBody: raw, headers: { 'x-paystack-signature': 'f'.repeat(128) } })
  assert.equal(bad.status, 401)
  const hook = await t.api('POST', '/api/payments/paystack/webhook', { rawBody: raw, headers: { 'x-paystack-signature': paystackSignature(raw) } })
  assert.equal(hook.status, 200, JSON.stringify(hook.data))
  assert.equal((await t.api('GET', `/api/payments/paystack/verify/${pay.data.reference}`, { token: s.parent })).data.receiptNo, v.data.receiptNo)
  const online = await t.query("SELECT count(*)::int AS n FROM fee_payments WHERE method = 'online'")
  assert.equal(online.rows[0].n, 1, 'recorded exactly once')
  assert.equal(await balanceOf(s.a2), 320)
})

test('a paid amount that does not match is never recorded; the webhook alone also records', async () => {
  const pay = await t.api('POST', `/api/parent/children/${s.a2}/fees/pay`, { token: s.parent, body: { amount: 50 } })
  paystack.setAmount(pay.data.reference, 100) // GHS 1.00 instead of 50.00
  const v = await t.api('GET', `/api/payments/paystack/verify/${pay.data.reference}`, { token: s.parent })
  assert.equal(v.data.status, 'failed')
  assert.equal(await balanceOf(s.a2), 320)

  const pay2 = await t.api('POST', `/api/parent/children/${s.a2}/fees/pay`, { token: s.parent, body: { amount: 20 } })
  const raw = JSON.stringify({ event: 'charge.success', data: { reference: pay2.data.reference } })
  assert.equal((await t.api('POST', '/api/payments/paystack/webhook', { rawBody: raw, headers: { 'x-paystack-signature': paystackSignature(raw) } })).status, 200)
  assert.equal(await balanceOf(s.a2), 300)

  const pending = await t.api('POST', `/api/parent/children/${s.a2}/fees/pay`, { token: s.parent, body: { amount: 5 } })
  paystack.setStatus(pending.data.reference, 'ongoing')
  assert.equal((await t.api('GET', `/api/payments/paystack/verify/${pending.data.reference}`, { token: s.parent })).data.status, 'pending')
  assert.equal((await t.api('POST', `/api/parent/children/${s.b1}/fees/pay`, { token: s.parent, body: { amount: 5 } })).status, 404, 'not their child')
})
