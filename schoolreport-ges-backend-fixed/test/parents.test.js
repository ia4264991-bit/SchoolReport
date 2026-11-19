// Parents: guardian phones, sign-in by SMS code, what a parent can see, notices and SMS
// (absence alerts, results, monthly limit).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApi, todayStr, eventually } from './helpers.js'

let t
const s = {}
const MUM = '+233244123456'   // two children at Alpha, one at Beta
const DAD = '+233201112223'

before(async () => {
  t = await startApi()
  ;({ schoolId: s.schoolA, admin: s.admin } = await t.newSchool('Alpha'))
  ;({ schoolId: s.schoolB, admin: s.adminB } = await t.newSchool('Beta'))
  s.c1 = await t.newClass(s.admin, 'Basic 1')
  s.c2 = await t.newClass(s.admin, 'Basic 2')
  s.teacher = (await t.newUser(s.admin, { fullName: 'Abena Teacher', email: 'abena@alpha.test', role: 'teacher', classId: s.c1 })).token
  s.math = (await t.api('POST', '/api/school/subjects', { token: s.admin, body: { name: 'Mathematics' } })).data._id
  s.cB = await t.newClass(s.adminB, 'Basic 3')
})

after(() => t.close())

test('guardian phones are stored in one form and checked', async () => {
  const a = await t.newPupil(s.admin, { fullName: 'Kojo Asare', classId: s.c1, guardianName: 'Mrs Asare', guardianPhone: '024 412 3456', guardianPhone2: '0201112223' })
  assert.equal(a.guardianPhone, MUM)
  assert.equal(a.guardianPhone2, DAD)
  s.kojo = a._id
  s.adwoa = (await t.newPupil(s.admin, { fullName: 'Adwoa Asare', gender: 'F', classId: s.c2, guardianName: 'Mrs Asare', guardianPhone: '+233 24 412 3456' }))._id
  s.yaw = (await t.newPupil(s.admin, { fullName: 'Yaw Other', classId: s.c1, guardianPhone: '0555000111' }))._id
  s.nophone = (await t.newPupil(s.admin, { fullName: 'No Phone', classId: s.c1 }))._id
  s.kwabena = (await t.newPupil(s.adminB, { fullName: 'Kwabena Beta', classId: s.cB, guardianPhone: '0244123456' }))._id

  const bad = await t.api('POST', '/api/students', { token: s.admin, body: { fullName: 'X', gender: 'M', classId: s.c1, guardianPhone: '12345' } })
  assert.equal(bad.status, 400)
  assert.match(bad.data.message, /Ghana phone/)
})

test('parent sign-in: generic answer, single-use code, 5 tries, 3 codes an hour', async () => {
  const before = t.smsOutbox.length
  const unknown = await t.api('POST', '/api/auth/parent/request-code', { body: { phone: '0270000000' } })
  assert.equal(unknown.status, 200)
  assert.equal(t.smsOutbox.length, before, 'no SMS to unknown numbers')
  assert.equal((await t.api('POST', '/api/auth/parent/request-code', { body: { phone: 'abc' } })).status, 400)

  // Code 1: five wrong guesses cancel it.
  const rq = await t.api('POST', '/api/auth/parent/request-code', { body: { phone: '0555000111' } })
  assert.equal(rq.data.message, unknown.data.message.replace('+233 27 *** 0000', '+233 55 *** 0111'), 'same wording either way')
  const code1 = t.smsOutbox.at(-1).message.match(/\b(\d{6})\b/)[1]
  const wrong = code1 === '000000' ? '111111' : '000000'
  for (let i = 0; i < 5; i++) {
    assert.equal((await t.api('POST', '/api/auth/parent/verify', { body: { phone: '0555000111', code: wrong } })).status, 400)
  }
  assert.equal((await t.api('POST', '/api/auth/parent/verify', { body: { phone: '0555000111', code: code1 } })).status, 400, 'cancelled')
  const stored = await t.query("SELECT code_hash FROM phone_login_codes WHERE phone = '+233555000111'")
  assert.match(stored.rows[0].code_hash, /^[0-9a-f]{64}$/, 'kept hashed')

  // Code 2 works once.
  const p = await t.parentLogin('0555000111')
  assert.equal(p.user.role, 'parent')
  assert.equal(p.user.email, null)
  assert.equal((await t.api('POST', '/api/auth/parent/verify', { body: { phone: '0555000111', code: p.code } })).status, 400, 'single use')

  // Code 3 is the last one this hour; a 4th request sends nothing.
  s.yawParent = (await t.parentLogin('0555000111')).token
  const n = t.smsOutbox.length
  assert.equal((await t.api('POST', '/api/auth/parent/request-code', { body: { phone: '0555000111' } })).status, 200)
  assert.equal(t.smsOutbox.length, n, 'hourly limit')
})

test('a parent with children at two schools picks the school', async () => {
  const before = t.smsOutbox.length
  await t.api('POST', '/api/auth/parent/request-code', { body: { phone: MUM } })
  const code = t.smsOutbox.slice(before).find((m) => m.kind === 'login_code').message.match(/\b(\d{6})\b/)[1]
  const choose = await t.api('POST', '/api/auth/parent/verify', { body: { phone: MUM, code } })
  assert.equal(choose.status, 200)
  assert.deepEqual(choose.data.chooseSchool.map((x) => x.name).sort(), ['Alpha School', 'Beta School'])
  const v = await t.api('POST', '/api/auth/parent/verify', { body: { phone: MUM, code, schoolId: s.schoolA } })
  assert.equal(v.status, 200, JSON.stringify(v.data))
  assert.equal(v.data.user.fullName, 'Mrs Asare')
  s.mum = v.data.token
})

test('a parent sees their own children only, and nothing of the staff side', async () => {
  const kids = await t.api('GET', '/api/parent/children', { token: s.mum })
  assert.equal(kids.status, 200)
  assert.deepEqual(kids.data.children.map((k) => k.fullName), ['Adwoa Asare', 'Kojo Asare'])
  assert.equal(kids.data.onlinePayment, false)

  await t.api('POST', `/api/scores/${s.c1}/1/bulk`, { token: s.teacher, body: { scores: {
    [s.kojo]: { [s.math]: { classScore: 80, examScore: 90 } },
    [s.yaw]: { [s.math]: { classScore: 50, examScore: 40 } },
  } } })
  const rep = await t.api('GET', `/api/reports/me?studentId=${s.kojo}`, { token: s.mum })
  assert.equal(rep.status, 200, JSON.stringify(rep.data))
  assert.equal(rep.data.card.student.fullName, 'Kojo Asare')
  assert.equal(rep.data.card.position, 1)
  assert.ok(!JSON.stringify(rep.data).includes('Yaw Other'))
  assert.equal((await t.api('GET', `/api/reports/me?studentId=${s.yaw}`, { token: s.mum })).status, 404, 'not her child')
  assert.equal((await t.api('GET', '/api/reports/me', { token: s.mum })).status, 404, 'two children: must pick one')

  for (const path of ['/api/students', `/api/attendance/${s.c1}`, `/api/reports/cards/${s.c1}/1`, '/api/fees/summary',
    '/api/users', '/api/messages/notices', `/api/scores/${s.c1}/1`, '/api/billing']) {
    assert.equal((await t.api('GET', path, { token: s.mum })).status, 403, path)
  }
  // Parents are not listed with staff.
  const users = (await t.api('GET', '/api/users', { token: s.admin })).data
  assert.ok(users.every((u) => u.role !== 'parent'))
})

test("absence alert: one SMS per parent phone per day, only when the school turns it on", async () => {
  const today = todayStr()
  const marks = { [s.kojo]: 'absent', [s.yaw]: 'present', [s.nophone]: 'present' }
  assert.equal((await t.api('PUT', `/api/attendance/${s.c1}/${today}`, { token: s.teacher, body: { marks } })).status, 200)
  await new Promise((r) => setTimeout(r, 200))
  assert.ok(!t.smsOutbox.some((m) => m.kind === 'absence'), 'off by default')

  assert.equal((await t.api('PUT', '/api/school/settings', { token: s.admin, body: { smsAbsenceAlerts: true } })).status, 200)
  // Mark present then absent again: newly absent → alert to both of Kojo's phones.
  await t.api('PUT', `/api/attendance/${s.c1}/${today}`, { token: s.teacher, body: { marks: { [s.kojo]: 'present' } } })
  await t.api('PUT', `/api/attendance/${s.c1}/${today}`, { token: s.teacher, body: { marks: { [s.kojo]: 'absent' } } })
  const alerts = await eventually(() => {
    const a = t.smsOutbox.filter((m) => m.kind === 'absence')
    return a.length >= 2 && a
  })
  assert.deepEqual(alerts.map((m) => m.to).sort(), [DAD, MUM].sort())
  assert.match(alerts[0].message, /Kojo Asare was marked ABSENT today/)

  await t.api('PUT', `/api/attendance/${s.c1}/${today}`, { token: s.teacher, body: { marks: { [s.kojo]: 'present' } } })
  await t.api('PUT', `/api/attendance/${s.c1}/${today}`, { token: s.teacher, body: { marks: { [s.kojo]: 'absent' } } })
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(t.smsOutbox.filter((m) => m.kind === 'absence').length, 2, 'not again the same day')

  const att = await t.api('GET', `/api/parent/children/${s.kojo}/attendance`, { token: s.mum })
  assert.deepEqual([att.data.present, att.data.total, att.data.absentDays], [0, 1, [today]])
})

test('notices reach the right parents; the SMS limit is respected', async () => {
  const before = t.smsOutbox.length
  const n = await t.api('POST', '/api/messages/notices', { token: s.admin, body: { title: 'PTA meeting', body: 'Friday at 2pm in the school hall.', sendSms: true } })
  assert.equal(n.status, 201, JSON.stringify(n.data))
  assert.equal(n.data.smsRecipients, 3, 'MUM, DAD, Yaw\'s parent')
  const sent = await eventually(() => t.smsOutbox.slice(before).filter((m) => m.kind === 'notice').length === 3)
  assert.ok(sent)
  assert.equal((await t.api('POST', '/api/messages/notices', { token: s.admin, body: { title: 'Basic 2 trip', body: 'Bring a packed lunch.', classId: s.c2 } })).status, 201)
  assert.equal((await t.api('POST', '/api/messages/notices', { token: s.teacher, body: { title: 'x', body: 'y' } })).status, 403)

  const mine = await t.api('GET', '/api/parent/notices', { token: s.mum })
  assert.deepEqual(mine.data.map((x) => x.title), ['Basic 2 trip', 'PTA meeting'])
  const theirs = await t.api('GET', '/api/parent/notices', { token: s.yawParent })
  assert.deepEqual(theirs.data.map((x) => x.title), ['PTA meeting'], 'class notices only for that class')

  const usage = await t.api('GET', '/api/messages/usage', { token: s.admin })
  assert.equal(usage.status, 200)
  assert.ok(usage.data.usedThisMonth >= 5)
  assert.equal(usage.data.pupilsWithoutPhone, 1)

  // The platform caps each school's SMS per month.
  await t.api('PUT', `/api/superadmin/schools/${s.schoolA}/billing`, { token: t.root, body: { smsMonthlyLimit: usage.data.usedThisMonth + 1 } })
  const over = await t.api('POST', '/api/messages/notices', { token: s.admin, body: { title: 'Again', body: 'Too many', sendSms: true } })
  assert.equal(over.status, 409)
  assert.match(over.data.message, /left this month/)
  await t.api('PUT', `/api/superadmin/schools/${s.schoolA}/billing`, { token: t.root, body: { smsMonthlyLimit: 500 } })
})

test('results by SMS: preview, then one message per pupil with marks and a phone', async () => {
  const pre = await t.api('GET', `/api/messages/results/${s.c1}/1`, { token: s.admin })
  assert.equal(pre.status, 200, JSON.stringify(pre.data))
  assert.equal(pre.data.pupils, 2, 'Kojo and Yaw have marks and a phone')
  assert.equal(pre.data.pupilsWithoutPhone, 1)
  assert.match(pre.data.sample, /Term 1 results: average/)
  const before = t.smsOutbox.length
  const r = await t.api('POST', `/api/messages/results/${s.c1}/1`, { token: s.admin })
  assert.equal(r.status, 200)
  await eventually(() => t.smsOutbox.slice(before).filter((m) => m.kind === 'results').length === 3)
})

test("removing a parent's number from the record ends their access", async () => {
  await t.api('PUT', `/api/students/${s.adwoa}`, { token: s.admin, body: { guardianPhone: '' } })
  const kids = await t.api('GET', '/api/parent/children', { token: s.mum })
  assert.deepEqual(kids.data.children.map((k) => k.fullName), ['Kojo Asare'])
  assert.equal((await t.api('GET', `/api/reports/me?studentId=${s.adwoa}`, { token: s.mum })).status, 404)
  assert.equal((await t.api('GET', '/api/reports/me', { token: s.mum })).status, 200, 'one child left: no need to pick')
})
