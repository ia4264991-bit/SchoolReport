// End-to-end API tests against a real PostgreSQL database.
//
//   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/schoolreport_test npm test
//
// The database is WIPED on every run, so its name must end in "_test".
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

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

let server, base

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

const NEW_PW = 'NewPassw0rd!'

/** Logs in with a temporary password, checks the forced change, returns a usable token. */
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
  return token
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

test('health check reaches the database', async () => {
  const r = await api('GET', '/api/health')
  assert.equal(r.status, 200)
  assert.equal(r.data.database, 'postgresql')
})

test('login rejects bad credentials and bad input without crashing', async () => {
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'root@test.local', password: 'nope' } })).status, 401)
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'nobody@test.local', password: 'nope' } })).status, 401)
  assert.equal((await api('POST', '/api/auth/login', { body: { email: { $ne: null }, password: 'x' } })).status, 400)
  assert.equal((await api('POST', '/api/auth/login', { body: {} })).status, 400)
})

test('superadmin creates two schools in one step each', async () => {
  const r = await api('POST', '/api/auth/login', { body: { email: 'root@test.local', password: 'RootPass#12345' } })
  assert.equal(r.status, 200)
  s.root = r.data.token

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
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'head@alpha.test', password: 'BrandNew#2026' } })).status, 200)
  assert.equal((await api('POST', '/api/auth/verify-otp', { body: { email: 'head@alpha.test', otp: 123456 } })).status, 400, 'non-string code is a 400, not a crash')
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
