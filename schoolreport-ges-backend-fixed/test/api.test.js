// End-to-end API tests against a real PostgreSQL database.
//
//   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/schoolreport_test npm test
//
// The database is WIPED on every run, so its name must end in "_test".
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'

/** A real (valid) RGBA PNG of the given size, built in memory. */
function makePng(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  const raw = Buffer.alloc(height * (1 + width * 4), 0x80)
  for (let y = 0; y < height; y++) raw[y * (1 + width * 4)] = 0 // filter byte per row
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

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
  API_RATE_LIMIT_MAX: '100000',
  SUPERADMIN_EMAIL: 'root@test.local',
  SUPERADMIN_PASSWORD: 'RootPass#12345',
})
delete process.env.SMTP_USER
delete process.env.SMTP_PASS
console.warn = () => {} // mailer "SMTP not set" notices

// Imported after the environment is set (some modules read it when loaded).
const { query, closePool } = await import('../shared/db.js')
const { migrate } = await import('../shared/migrate.js')
const { seedSuperadmin } = await import('../gateway/src/seed.js')
const { createApp } = await import('../gateway/src/app.js')
const { hashOtp } = await import('../services/auth/src/models/User.js')
const { sniffImage } = await import('../shared/image.js')

let server, base

async function api(method, path, { token, body, headers = {}, url = base } = {}) {
  const res = await fetch(url + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data, headers: res.headers }
}

const NEW_PW = 'NewPassw0rd!'

/**
 * Logs in with a temporary password, checks the forced change, and returns the fresh
 * token the change hands back (the login token stops working once the password changes).
 */
async function firstLogin(email, tempPassword) {
  const r = await api('POST', '/api/auth/login', { body: { email, password: tempPassword } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.mustChangePassword, true)
  const token = r.data.token
  const blocked = await api('GET', '/api/school/classes', { token })
  assert.equal(blocked.status, 403, 'must change password before using the app')
  const ch = await api('POST', '/api/auth/change-password', {
    token, body: { currentPassword: tempPassword, newPassword: NEW_PW },
  })
  assert.equal(ch.status, 200, JSON.stringify(ch.data))
  assert.ok(ch.data.token, 'change-password returns a new token')
  assert.equal((await api('GET', '/api/auth/me', { token })).status, 401, 'the old token is signed out')
  return ch.data.token
}

before(async () => {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await migrate({ log: () => {} })
  await seedSuperadmin({ log: () => {} })
  server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((r) => server.close(r))
  await closePool()
})

// Shared state, filled in by the tests in order (node:test runs them sequentially).
const s = {}

test('health check reaches the database; security headers are set', async () => {
  const r = await api('GET', '/api/health')
  assert.equal(r.status, 200)
  assert.equal(r.data.database, 'postgresql')
  assert.equal((await api('GET', '/api/health/live')).status, 200)
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/)
  assert.match(r.headers.get('x-request-id'), /^[0-9a-f-]{36}$/)
  assert.equal(r.headers.get('x-powered-by'), null)
})

test('with ORIGIN_VERIFY_SECRET set, only requests carrying it are served', async () => {
  process.env.ORIGIN_VERIFY_SECRET = 'cloudfront-only-secret'
  const guarded = createApp().listen(0)
  delete process.env.ORIGIN_VERIFY_SECRET
  await new Promise((r) => guarded.once('listening', r))
  const url = `http://127.0.0.1:${guarded.address().port}`
  try {
    assert.equal((await api('GET', '/api/health', { url })).status, 403)
    assert.equal((await api('GET', '/api/health', { url, headers: { 'x-origin-verify': 'wrong-secret-value-xx' } })).status, 403)
    assert.equal((await api('GET', '/api/health', { url, headers: { 'x-origin-verify': 'cloudfront-only-secret' } })).status, 200)
    assert.equal((await api('GET', '/api/health/live', { url })).status, 200, 'container health check is exempt')
  } finally {
    await new Promise((r) => guarded.close(r))
  }
})

test('login rejects bad credentials and bad input without crashing', async () => {
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'root@test.local', password: 'nope' } })).status, 401)
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'nobody@test.local', password: 'nope' } })).status, 401)
  assert.equal((await api('POST', '/api/auth/login', { body: { email: { $ne: null }, password: 'x' } })).status, 400)
  assert.equal((await api('POST', '/api/auth/login', { body: {} })).status, 400)
})

test('superadmin creates two schools in one step each', async () => {
  // The seeded superadmin password is a bootstrap credential: it must be changed first.
  s.root = await firstLogin('root@test.local', 'RootPass#12345')

  for (const [key, n] of [['A', 'Alpha'], ['B', 'Beta']]) {
    const c = await api('POST', '/api/superadmin/schools', {
      token: s.root,
      body: { schoolName: `${n} School`, schoolEmail: `${n}@school.test`, adminName: `${n} Admin`, adminEmail: `admin@${n}.test`, region: 'Greater Accra' },
    })
    assert.equal(c.status, 201, JSON.stringify(c.data))
    assert.equal(c.data.school.email, `${n.toLowerCase()}@school.test`)
    assert.equal(c.data.emailQueued, false, 'SMTP is not configured in tests')
    s[`school${key}`] = c.data.school._id
    s[`admin${key}Temp`] = c.data.credentials.password
  }

  const dup = await api('POST', '/api/superadmin/schools', {
    token: s.root,
    body: { schoolName: 'Again', schoolEmail: 'alpha@school.test', adminName: 'X', adminEmail: 'x@x.test' },
  })
  assert.equal(dup.status, 409)
  // The failed attempt must not leave a half-created school behind.
  assert.equal((await api('GET', '/api/superadmin/schools', { token: s.root })).data.length, 2)
})

test('new admin must change the temporary password first', async () => {
  s.adminA = await firstLogin('admin@alpha.test', s.adminATemp)
  s.adminB = await firstLogin('admin@beta.test', s.adminBTemp)
  const me = await api('GET', '/api/auth/me', { token: s.adminA })
  assert.equal(me.data.mustChangePassword, false)
  assert.equal(me.data.role, 'admin')
})

test('settings are created with the current academic year and can be updated', async () => {
  const g = await api('GET', '/api/school/settings', { token: s.adminA })
  assert.equal(g.status, 200)
  assert.match(g.data.academicYear, /^\d{4}\/\d{4}$/)
  assert.equal(g.data.schoolName, 'Alpha School')

  const u = await api('PUT', '/api/school/settings', {
    token: s.adminA,
    body: { ...g.data, schoolName: 'Alpha Basic School', term: '2', nextTermDate: '2027-01-12', schoolId: s.schoolB },
  })
  assert.equal(u.status, 200, JSON.stringify(u.data))
  assert.equal(u.data.schoolId, s.schoolA, 'schoolId in the body is ignored')
  assert.equal(u.data.nextTermDate, '2027-01-12')
  assert.equal(u.data.term, '2')
  s.year = u.data.academicYear
  const schools = await api('GET', '/api/superadmin/schools', { token: s.root })
  assert.ok(schools.data.some((x) => x.name === 'Alpha Basic School'), 'school name kept in step')

  assert.equal((await api('PUT', '/api/school/settings', { token: s.adminA, body: { term: '7' } })).status, 400)
})

test('admin sets up classes and subjects; max marks round-trip', async () => {
  for (const name of ['Class 4A', 'Class 4B']) {
    const r = await api('POST', '/api/school/classes', { token: s.adminA, body: { name, level: 'Primary 4' } })
    assert.equal(r.status, 201)
  }
  const classes = (await api('GET', '/api/school/classes', { token: s.adminA })).data
  s.c4A = classes.find((c) => c.name === 'Class 4A')._id
  s.c4B = classes.find((c) => c.name === 'Class 4B')._id

  const math = await api('POST', '/api/school/subjects', { token: s.adminA, body: { name: 'Mathematics', code: 'MATH', order: 1 } })
  const eng = await api('POST', '/api/school/subjects', { token: s.adminA, body: { name: 'English', order: 2 } })
  assert.equal(math.status, 201)
  s.math = math.data._id
  s.eng = eng.data._id

  const mm = await api('PUT', '/api/school/max-marks', { token: s.adminA, body: { [s.math]: '30', [s.eng]: '' } })
  assert.equal(mm.status, 200, JSON.stringify(mm.data))
  assert.deepEqual(mm.data, { [s.math]: 30 })
  assert.equal((await api('PUT', '/api/school/max-marks', { token: s.adminA, body: { [s.math]: -5 } })).status, 400)
  // Another school's admin cannot set marks on this school's subject.
  assert.equal((await api('PUT', '/api/school/max-marks', { token: s.adminB, body: { [s.math]: 50 } })).status, 400)
})

test('class edits ignore schoolId (no moving a class into another school)', async () => {
  const r = await api('PUT', `/api/school/classes/${s.c4B}`, {
    token: s.adminA, body: { name: 'Class 4B', level: 'P4', schoolId: s.schoolB },
  })
  assert.equal(r.status, 200)
  assert.equal(r.data.schoolId, s.schoolA)
  assert.equal((await api('PUT', `/api/school/classes/${s.c4B}`, { token: s.adminB, body: { name: 'Stolen' } })).status, 404)
  assert.equal((await api('GET', `/api/school/schools/${s.schoolB}`, { token: s.adminA })).status, 404)
  assert.equal((await api('GET', `/api/school/schools/${s.schoolA}`, { token: s.adminA })).status, 200)
})

test('admin creates staff; role escalation and self-lockout are refused', async () => {
  const t = await api('POST', '/api/users', {
    token: s.adminA,
    body: { fullName: 'Ama Teacher', email: 'Ama@Alpha.test', role: 'teacher', classId: s.c4A, schoolName: 'Fake Name' },
  })
  assert.equal(t.status, 201, JSON.stringify(t.data))
  assert.equal(t.data.user.email, 'ama@alpha.test')
  s.teacherId = t.data.user._id
  s.teacherTemp = t.data.credentials.password

  const h = await api('POST', '/api/users', { token: s.adminA, body: { fullName: 'Kofi Head', email: 'head@alpha.test', role: 'head' } })
  assert.equal(h.status, 201)
  s.headTemp = h.data.credentials.password

  assert.equal((await api('POST', '/api/users', { token: s.adminA, body: { fullName: 'X', email: 'ama@alpha.test', role: 'teacher' } })).status, 409)
  assert.equal((await api('POST', '/api/users', { token: s.adminA, body: { fullName: 'X', email: 'x@alpha.test', role: 'superadmin' } })).status, 400)
  assert.equal((await api('POST', '/api/users', { token: s.adminA, body: { fullName: 'X', email: 'y@alpha.test', role: 'teacher', classId: s.c4A.replace(/.$/, '0') } })).status, 400)

  // The old bug: PUT accepted role "superadmin".
  assert.equal((await api('PUT', `/api/users/${s.teacherId}`, { token: s.adminA, body: { role: 'superadmin' } })).status, 400)
  const meId = (await api('GET', '/api/auth/me', { token: s.adminA })).data._id
  assert.equal((await api('PUT', `/api/users/${meId}`, { token: s.adminA, body: { role: 'teacher' } })).status, 400)
  assert.equal((await api('PUT', `/api/users/${meId}`, { token: s.adminA, body: { isActive: false } })).status, 400)
  assert.equal((await api('DELETE', `/api/users/${meId}`, { token: s.adminA })).status, 400)
  // Other school's admin can't touch this user.
  assert.equal((await api('PUT', `/api/users/${s.teacherId}`, { token: s.adminB, body: { fullName: 'Hacked' } })).status, 404)
  assert.equal((await api('GET', '/api/users/not-a-uuid', { token: s.adminA })).status, 404)

  s.teacher = await firstLogin('ama@alpha.test', s.teacherTemp)
  s.head = await firstLogin('head@alpha.test', s.headTemp)
})

test('students: teachers are limited to their own class', async () => {
  for (const [name, gender, cls] of [['Kwame Mensah', 'M', s.c4A], ['Akosua Boateng', 'F', s.c4A], ['Yaw Owusu', 'M', s.c4A], ['Esi Asante', 'F', s.c4B]]) {
    const r = await api('POST', '/api/students', { token: s.adminA, body: { fullName: name, gender, classId: cls, dateOfBirth: '2016-03-04' } })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    assert.equal(r.data.dateOfBirth, '2016-03-04', 'date is not shifted by time zones')
  }
  const all4A = (await api('GET', `/api/students?classId=${s.c4A}`, { token: s.adminA })).data
  assert.equal(all4A.length, 3)
  s.kwame = all4A.find((x) => x.fullName === 'Kwame Mensah')._id
  s.akosua = all4A.find((x) => x.fullName === 'Akosua Boateng')._id
  s.yaw = all4A.find((x) => x.fullName === 'Yaw Owusu')._id
  s.esi = (await api('GET', `/api/students?classId=${s.c4B}`, { token: s.adminA })).data[0]._id

  // Teacher asking for 4B still only gets 4A.
  const tList = await api('GET', `/api/students?classId=${s.c4B}`, { token: s.teacher })
  assert.equal(tList.status, 200)
  assert.ok(tList.data.every((x) => x.classId === s.c4A))
  assert.equal((await api('POST', '/api/students', { token: s.teacher, body: { fullName: 'Sneaky', gender: 'M', classId: s.c4B } })).status, 403)
  const own = await api('POST', '/api/students', { token: s.teacher, body: { fullName: 'Abena Teacher-Added', gender: 'F' } })
  assert.equal(own.status, 201)
  assert.equal(own.data.classId, s.c4A)
  assert.equal((await api('PUT', `/api/students/${s.esi}`, { token: s.teacher, body: { fullName: 'Changed' } })).status, 404)
  assert.equal((await api('PUT', `/api/students/${s.kwame}`, { token: s.teacher, body: { classId: s.c4B } })).status, 403)
  assert.equal((await api('DELETE', `/api/students/${own.data._id}`, { token: s.teacher })).status, 403)
  assert.equal((await api('DELETE', `/api/students/${own.data._id}`, { token: s.head })).status, 200)

  // Cross-school: school B sees none of school A's students, and can't move them.
  assert.equal((await api('GET', `/api/students?classId=${s.c4A}`, { token: s.adminB })).status, 404)
  assert.equal((await api('GET', `/api/students/${s.kwame}`, { token: s.adminB })).status, 404)
  const moved = await api('PUT', `/api/students/${s.kwame}`, { token: s.adminA, body: { fullName: 'Kwame Mensah', schoolId: s.schoolB } })
  assert.equal(moved.data.schoolId, s.schoolA, 'schoolId in the body is ignored')

  assert.equal((await api('POST', '/api/students', { token: s.adminA, body: { fullName: 'Bad', gender: 'X', classId: s.c4A } })).status, 400)
  assert.equal((await api('POST', '/api/students', { token: s.adminA, body: { fullName: 'Bad', gender: 'M', classId: s.c4A, dateOfBirth: 'yesterday' } })).status, 400)
})

test('classes report real student counts and teacher names; dashboard stats are real', async () => {
  const classes = (await api('GET', '/api/school/classes', { token: s.adminA })).data
  const a = classes.find((c) => c._id === s.c4A)
  assert.equal(a.studentCount, 3)
  assert.equal(a.teacherName, 'Ama Teacher')
  const stats = (await api('GET', '/api/school/stats', { token: s.adminA })).data
  assert.deepEqual(stats, { totalClasses: 2, subjectsCount: 2, totalStudents: 4, reportsGenerated: 0 })
})

test('scores: validation, teacher limits, upsert and clearing', async () => {
  // Teacher cannot save or read another class (the old code allowed saving).
  const other = { [s.esi]: { [s.math]: { classScore: 20, examScore: 50 } } }
  assert.equal((await api('POST', `/api/scores/${s.c4B}/2/bulk`, { token: s.teacher, body: { scores: other } })).status, 403)
  assert.equal((await api('GET', `/api/scores/${s.c4B}/2`, { token: s.teacher })).status, 403)

  // Over the subject maximum (30) or exam > 100 → nothing saved.
  const bad = await api('POST', `/api/scores/${s.c4A}/2/bulk`, {
    token: s.teacher, body: { scores: { [s.kwame]: { [s.math]: { classScore: 31, examScore: 50 }, [s.eng]: { classScore: 10, examScore: 150 } } } },
  })
  assert.equal(bad.status, 400)
  assert.match(bad.data.message, /between 0 and 30/)
  // A student from another class cannot be written through this class.
  assert.equal((await api('POST', `/api/scores/${s.c4A}/2/bulk`, { token: s.adminA, body: { scores: other } })).status, 400)
  assert.equal((await api('POST', `/api/scores/${s.c4A}/5/bulk`, { token: s.adminA, body: { scores: {} } })).status, 400)

  const good = await api('POST', `/api/scores/${s.c4A}/2/bulk`, {
    token: s.teacher,
    body: { scores: {
      [s.kwame]:  { [s.math]: { classScore: '27', examScore: '80' }, [s.eng]: { classScore: 70, examScore: 65 } },
      [s.akosua]: { [s.math]: { classScore: 30, examScore: 95 }, [s.eng]: { classScore: 90, examScore: 88 } },
      [s.yaw]:    { [s.math]: { classScore: 12.5, examScore: '' } },
    } },
  })
  assert.equal(good.status, 200, JSON.stringify(good.data))
  assert.equal(good.data.saved, 5)

  let rows = (await api('GET', `/api/scores/${s.c4A}/2`, { token: s.teacher })).data
  assert.equal(rows.length, 5)
  const yawMath = rows.find((r) => r.studentId === s.yaw)
  assert.equal(yawMath.classScore, 12.5, 'numbers come back as numbers')
  assert.equal(yawMath.examScore, 0)
  assert.equal(yawMath.academicYear, s.year)

  // Saving again updates instead of duplicating; both fields empty deletes the score.
  const again = await api('POST', `/api/scores/${s.c4A}/2/bulk`, {
    token: s.teacher,
    body: { scores: { [s.kwame]: { [s.math]: { classScore: 28, examScore: 81 } }, [s.yaw]: { [s.math]: { classScore: '', examScore: '' } } } },
  })
  assert.equal(again.data.saved, 1)
  assert.equal(again.data.cleared, 1)
  rows = (await api('GET', `/api/scores/${s.c4A}/2`, { token: s.adminA })).data
  assert.equal(rows.length, 4)
  assert.equal(rows.find((r) => r.studentId === s.kwame && r.subjectId === s.math).classScore, 28)

  const one = await api('GET', `/api/scores/student/${s.kwame}/2`, { token: s.teacher })
  assert.equal(one.data.length, 2)
  assert.equal((await api('GET', `/api/scores/student/${s.esi}/2`, { token: s.teacher })).status, 404)

  const grouped = (await api('GET', `/api/reports/class/${s.c4A}/2`, { token: s.head })).data
  assert.equal(Object.keys(grouped).length, 2)

  const stats = (await api('GET', '/api/school/stats', { token: s.adminA })).data
  assert.equal(stats.reportsGenerated, 2, 'two students have scores this term')

  // Single-score edit respects limits.
  const id = rows[0]._id
  assert.equal((await api('PUT', `/api/scores/${id}`, { token: s.adminA, body: { examScore: 101 } })).status, 400)
  assert.equal((await api('PUT', `/api/scores/${id}`, { token: s.adminA, body: { examScore: 77 } })).data.examScore, 77)
})

test('a new academic year does not overwrite last year\'s scores', async () => {
  const settings = (await api('GET', '/api/school/settings', { token: s.adminA })).data
  await api('PUT', '/api/school/settings', { token: s.adminA, body: { academicYear: '2099/2100' } })
  assert.equal((await api('GET', `/api/scores/${s.c4A}/2`, { token: s.adminA })).data.length, 0)
  await api('POST', `/api/scores/${s.c4A}/2/bulk`, { token: s.adminA, body: { scores: { [s.kwame]: { [s.math]: { classScore: 1, examScore: 1 } } } } })
  // Old year still intact, and readable by asking for it.
  const old = await api('GET', `/api/scores/${s.c4A}/2?academicYear=${encodeURIComponent(s.year)}`, { token: s.adminA })
  assert.equal(old.data.length, 4)
  await api('PUT', '/api/school/settings', { token: s.adminA, body: { academicYear: settings.academicYear } })
})

test('analytics use each subject\'s max mark', async () => {
  const r = await api('GET', `/api/reports/school/${s.schoolA}/analytics`, { token: s.head })
  assert.equal(r.status, 200)
  assert.equal(r.data.totalEntries, 4)
  // Kwame math 28/30 & 81 → 37.33+48.6; Kwame eng 70/100 & 65 → 28+39; Akosua math 30/30 & 95 → 40+57; Akosua eng 90 & 88 → 36+52.8
  // (one of the four exam scores was then edited to 77 — check the range instead of an exact value)
  assert.ok(r.data.avgScore > 70 && r.data.avgScore < 90, `avg ${r.data.avgScore}`)
  assert.equal((await api('GET', `/api/reports/school/${s.schoolA}/analytics`, { token: s.adminB })).status, 403)
  assert.equal((await api('GET', `/api/reports/school/${s.schoolA}/analytics`, { token: s.teacher })).status, 403)
})

test('class with active students cannot be deleted', async () => {
  const r = await api('DELETE', `/api/school/classes/${s.c4A}`, { token: s.adminA })
  assert.equal(r.status, 409)
  assert.match(r.data.message, /3 student/)
  assert.equal((await api('DELETE', `/api/school/classes/${s.c4A}`, { token: s.head })).status, 403)
})

test('moving a teacher to another class takes effect immediately', async () => {
  const r = await api('PUT', `/api/users/${s.teacherId}`, { token: s.adminA, body: { classId: s.c4B } })
  assert.equal(r.status, 200)
  // Same token as before — the old version kept the old class until the token expired.
  assert.equal((await api('GET', `/api/scores/${s.c4A}/2`, { token: s.teacher })).status, 403)
  assert.equal((await api('GET', `/api/scores/${s.c4B}/2`, { token: s.teacher })).status, 200)
  await api('PUT', `/api/users/${s.teacherId}`, { token: s.adminA, body: { classId: s.c4A } })
})

test('student logins cannot read other students\' records', async () => {
  const u = await api('POST', '/api/users', { token: s.adminA, body: { fullName: 'Pupil Login', email: 'pupil@alpha.test', role: 'student', classId: s.c4A } })
  const tok = await firstLogin('pupil@alpha.test', u.data.credentials.password)
  assert.equal((await api('GET', '/api/students', { token: tok })).status, 403)
  assert.equal((await api('GET', `/api/scores/${s.c4A}/2`, { token: tok })).status, 403)
  assert.equal((await api('GET', `/api/reports/class/${s.c4A}/2`, { token: tok })).status, 403)
})

test('password reset code: works once, and locks after 5 wrong guesses', async () => {
  const userId = (await api('GET', '/api/auth/me', { token: s.head })).data._id
  const setCode = (code) => query(
    `UPDATE users SET otp_hash = $2, otp_expires_at = now() + interval '10 minutes', otp_attempts = 0 WHERE id = $1`,
    [userId, hashOtp(userId, code)]
  )

  const fp = await api('POST', '/api/auth/forgot-password', { body: { email: 'head@alpha.test' } })
  assert.equal(fp.status, 200)
  const unknown = await api('POST', '/api/auth/forgot-password', { body: { email: 'ghost@alpha.test' } })
  assert.deepEqual(unknown.data, fp.data, 'same answer for unknown emails')
  const stored = await query('SELECT otp_hash FROM users WHERE id = $1', [userId])
  assert.match(stored.rows[0].otp_hash, /^[0-9a-f]{64}$/, 'code is stored hashed')

  await setCode('123456')
  for (let i = 0; i < 5; i++) {
    assert.equal((await api('POST', '/api/auth/verify-otp', { body: { email: 'head@alpha.test', otp: '000000' } })).status, 400)
  }
  assert.equal((await api('POST', '/api/auth/verify-otp', { body: { email: 'head@alpha.test', otp: '123456' } })).status, 400, 'locked after 5 misses')

  await setCode('654321')
  assert.equal((await api('POST', '/api/auth/verify-otp', { body: { email: 'head@alpha.test', otp: '654321' } })).status, 200)
  assert.equal((await api('POST', '/api/auth/reset-password', { body: { email: 'head@alpha.test', otp: '654321', newPassword: 'short' } })).status, 400)
  assert.equal((await api('POST', '/api/auth/reset-password', { body: { email: 'head@alpha.test', otp: '654321', newPassword: 'BrandNew#2026' } })).status, 200)
  assert.equal((await api('POST', '/api/auth/reset-password', { body: { email: 'head@alpha.test', otp: '654321', newPassword: 'Again#20260' } })).status, 400, 'code is single-use')
  assert.equal((await api('GET', '/api/auth/me', { token: s.head })).status, 401, 'a reset signs out existing sessions')
  const relog = await api('POST', '/api/auth/login', { body: { email: 'head@alpha.test', password: 'BrandNew#2026' } })
  assert.equal(relog.status, 200)
  s.head = relog.data.token
  assert.equal((await api('POST', '/api/auth/verify-otp', { body: { email: 'head@alpha.test', otp: 123456 } })).status, 400, 'non-string code is a 400, not a crash')
})

test('image type check reads the real bytes', () => {
  assert.deepEqual(sniffImage(makePng(300, 120)), { type: 'image/png', width: 300, height: 120 })
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), // APP0 segment
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x01, 0x90]), Buffer.alloc(16), // SOF0 200x400
  ])
  assert.deepEqual(sniffImage(jpeg), { type: 'image/jpeg', width: 400, height: 200 })
  const webp = Buffer.alloc(40)
  webp.write('RIFF', 0, 'latin1'); webp.write('WEBP', 8, 'latin1'); webp.write('VP8X', 12, 'latin1')
  webp.writeUIntLE(511, 24, 3); webp.writeUIntLE(255, 27, 3)
  assert.deepEqual(sniffImage(webp), { type: 'image/webp', width: 512, height: 256 })
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null)
  assert.equal(sniffImage(Buffer.from('GIF89a' + 'x'.repeat(40))), null)
})

test('school logo: upload, read, cache, permissions, limits, remove', async () => {
  const png = makePng(256, 128)
  const put = (token, body, type = 'image/png') => fetch(`${base}/api/school/logo`, {
    method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': type }, body,
  })

  let r = await put(s.adminA, png)
  assert.equal(r.status, 200, await r.clone().text())
  const { logoVersion } = await r.json()
  assert.match(logoVersion, /^[0-9a-f]{16}$/)
  assert.equal((await api('GET', '/api/school/settings', { token: s.teacher })).data.logoVersion, logoVersion)

  // Any user of the school can load it (the report sheet needs it); bytes come back unchanged.
  r = await fetch(`${base}/api/school/logo?v=${logoVersion}`, { headers: { authorization: `Bearer ${s.teacher}` } })
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'image/png')
  assert.equal(r.headers.get('cache-control'), 'private, max-age=86400')
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(png))
  const etag = r.headers.get('etag')
  r = await fetch(`${base}/api/school/logo`, { headers: { authorization: `Bearer ${s.teacher}`, 'if-none-match': etag } })
  assert.equal(r.status, 304)

  // Only admin/head may change it; only real PNG/JPEG/WebP within limits is accepted.
  assert.equal((await put(s.teacher, png)).status, 403)
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  assert.equal((await put(s.adminA, svg, 'image/svg+xml')).status, 415)
  assert.equal((await put(s.adminA, svg, 'image/png')).status, 415, 'a lying Content-Type does not help')
  assert.equal((await put(s.adminA, makePng(8, 8))).status, 400, 'too small')
  assert.equal((await put(s.adminA, Buffer.alloc(600 * 1024, 1))).status, 413, 'over 512 KB')
  assert.equal((await put(s.head, makePng(64, 64))).status, 200, 'head teacher may change it')

  // Other schools never see it.
  assert.equal((await api('GET', '/api/school/logo', { token: s.adminB })).status, 404)

  assert.equal((await api('DELETE', '/api/school/logo', { token: s.teacher })).status, 403)
  assert.equal((await api('DELETE', '/api/school/logo', { token: s.adminA })).status, 200)
  assert.equal((await api('GET', '/api/school/logo', { token: s.adminA })).status, 404)
  assert.equal((await api('GET', '/api/school/settings', { token: s.adminA })).data.logoVersion, null)
  assert.equal((await put(s.adminA, png)).status, 200) // leave one in place for the audit test
})

test('admin password reset signs the user out everywhere', async () => {
  const u = await api('POST', '/api/users', { token: s.adminA, body: { fullName: 'Reset Me', email: 'resetme@alpha.test', role: 'head' } })
  const tok = await firstLogin('resetme@alpha.test', u.data.credentials.password)
  assert.equal((await api('GET', '/api/auth/me', { token: tok })).status, 200)
  const r = await api('POST', `/api/users/${u.data.user._id}/reset-password`, { token: s.adminA })
  assert.equal(r.status, 200)
  assert.equal((await api('GET', '/api/auth/me', { token: tok })).status, 401)
})

test('audit log records who changed what, per school', async () => {
  const all = await api('GET', '/api/audit?limit=200', { token: s.adminA })
  assert.equal(all.status, 200)
  const actions = all.data.entries.map((e) => e.action)
  for (const a of ['settings.update', 'class.create', 'class.update', 'subject.create', 'max_marks.update',
    'user.create', 'user.update', 'student.create', 'student.remove', 'scores.save', 'score.update',
    'auth.change_password', 'auth.reset_password', 'user.reset_password',
    'settings.logo_update', 'settings.logo_remove']) {
    assert.ok(actions.includes(a), `missing audit action ${a}`)
  }
  assert.ok(all.data.entries.every((e) => e.schoolId === s.schoolA), 'admin sees only own school')

  // The second save changed Kwame's maths marks: old and new values are recorded.
  const saves = (await api('GET', '/api/audit?action=scores.', { token: s.adminA })).data.entries
  const change = saves.flatMap((e) => e.details.modified || []).find((m) => m.studentId === s.kwame && m.subjectId === s.math)
  assert.deepEqual(change.classScore, [27, 28])
  assert.deepEqual(change.examScore, [80, 81])
  assert.ok(saves.some((e) => (e.details.removed || []).some((m) => m.studentId === s.yaw)), 'cleared score recorded')
  assert.ok(saves.every((e) => e.actor.name && e.requestId), 'actor and request id recorded')

  // Filter by record; paging; permissions.
  const forKwame = await api('GET', `/api/audit?targetType=student&targetId=${s.kwame}`, { token: s.adminA })
  assert.ok(forKwame.data.entries.length >= 1)
  const page1 = await api('GET', '/api/audit?limit=3', { token: s.adminA })
  assert.equal(page1.data.entries.length, 3)
  const page2 = await api('GET', `/api/audit?limit=3&before=${page1.data.nextBefore}`, { token: s.adminA })
  assert.ok(page2.data.entries.every((e) => e.id < page1.data.nextBefore))
  assert.equal((await api('GET', '/api/audit', { token: s.head })).status, 403)
  assert.equal((await api('GET', '/api/audit', { token: s.teacher })).status, 403)
  const rootView = await api('GET', `/api/audit?action=school.create`, { token: s.root })
  assert.equal(rootView.data.entries.length, 2)
  assert.equal((await api('GET', '/api/audit?before=abc', { token: s.adminA })).status, 400)

  // No secrets ever land in the log.
  const raw = JSON.stringify(all.data)
  assert.ok(!/password_hash|otp_hash|\$2[aby]\$/.test(raw))
})

test('deactivating a school or user cuts off existing sessions at once', async () => {
  const t = await api('PUT', `/api/superadmin/schools/${s.schoolB}/toggle`, { token: s.root })
  assert.equal(t.data.school.isActive, false)
  assert.equal((await api('GET', '/api/school/classes', { token: s.adminB })).status, 401)
  const login = await api('POST', '/api/auth/login', { body: { email: 'admin@beta.test', password: NEW_PW } })
  assert.equal(login.status, 403)
  assert.match(login.data.message, /deactivated/)

  assert.equal((await api('DELETE', `/api/users/${s.teacherId}`, { token: s.adminA })).status, 200)
  assert.equal((await api('GET', '/api/auth/me', { token: s.teacher })).status, 401)

  assert.equal((await api('GET', '/api/superadmin/schools', { token: s.adminA })).status, 403)
  assert.equal((await api('PUT', '/api/superadmin/schools/not-a-uuid/toggle', { token: s.root })).status, 404)
})

test('unknown routes and malformed JSON get clean errors', async () => {
  assert.equal((await api('GET', '/api/nope')).status, 404)
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })
  assert.equal(res.status, 400)
})
