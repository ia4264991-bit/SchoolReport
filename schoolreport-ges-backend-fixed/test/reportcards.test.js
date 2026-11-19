// Terminal report cards built on the server: grading scale, class-score weight, positions,
// remarks and who may write them.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApi } from './helpers.js'

let t
const s = {}

before(async () => {
  t = await startApi()
  ;({ admin: s.admin } = await t.newSchool('Gamma'))
  s.cls = await t.newClass(s.admin, 'Basic 5')
  s.other = await t.newClass(s.admin, 'Basic 6')
  s.teacher = (await t.newUser(s.admin, { fullName: 'Efua Teacher', email: 'efua@gamma.test', role: 'teacher', classId: s.cls })).token
  s.head = (await t.newUser(s.admin, { fullName: 'Kwesi Head', email: 'head@gamma.test', role: 'head' })).token
  s.math = (await t.api('POST', '/api/school/subjects', { token: s.admin, body: { name: 'Mathematics', order: 1 } })).data._id
  s.eng = (await t.api('POST', '/api/school/subjects', { token: s.admin, body: { name: 'English Language', order: 2 } })).data._id
  await t.api('PUT', '/api/school/max-marks', { token: s.admin, body: { [s.math]: 30 } })
  s.ama = (await t.newPupil(s.admin, { fullName: 'Ama Owusu', gender: 'F', classId: s.cls }))._id
  s.kofi = (await t.newPupil(s.admin, { fullName: 'Kofi Annan', classId: s.cls }))._id
  s.esi = (await t.newPupil(s.admin, { fullName: 'Esi Mensah', gender: 'F', classId: s.cls }))._id
  s.away = (await t.newPupil(s.admin, { fullName: 'Other Class', classId: s.other }))._id
})

after(() => t.close())

const cards = async (token = s.admin) => {
  const r = await t.api('GET', `/api/reports/cards/${s.cls}/1`, { token })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  return r.data
}
const cardOf = (data, id) => data.cards.find((c) => c.student._id === id)

test('new schools grade with the NaCCA proficiency levels; scales are checked', async () => {
  const st = (await t.api('GET', '/api/school/settings', { token: s.admin })).data
  assert.equal(st.gradingScale.preset, 'nacca')
  assert.deepEqual(st.gradingScale.bands.map((b) => b.grade), ['HP', 'P', 'AP', 'D', 'E'])
  assert.equal(st.classScoreWeight, 40)

  const bad = async (gradingScale) => (await t.api('PUT', '/api/school/settings', { token: s.admin, body: { gradingScale } })).status
  assert.equal(await bad({ bands: [{ min: 50, grade: 'A' }, { min: 60, grade: 'B' }, { min: 0, grade: 'C' }] }), 400, 'not highest first')
  assert.equal(await bad({ bands: [{ min: 50, grade: 'A' }, { min: 10, grade: 'B' }] }), 400, 'last band must start at 0')
  assert.equal(await bad({ bands: [{ min: 50, grade: '' }, { min: 0, grade: 'B' }] }), 400, 'grade needed')
  assert.equal(await bad('A1'), 400)
  assert.equal((await t.api('PUT', '/api/school/settings', { token: s.admin, body: { classScoreWeight: 120 } })).status, 400)
  assert.equal((await t.api('PUT', '/api/school/settings', { token: s.teacher, body: { classScoreWeight: 50 } })).status, 403)

  const presets = await t.api('GET', '/api/school/grading-presets', { token: s.teacher })
  assert.deepEqual(Object.keys(presets.data), ['nacca', 'bece', 'wassce'])
})

test('cards: totals, grades, class and subject positions computed on the server', async () => {
  const save = await t.api('POST', `/api/scores/${s.cls}/1/bulk`, {
    token: s.teacher,
    body: { scores: {
      // Ama: Maths 30/30 class + 100 exam = 100; English 80 + 70 → 32 + 42 = 74 → average 87
      [s.ama]: { [s.math]: { classScore: 30, examScore: 100 }, [s.eng]: { classScore: 80, examScore: 70 } },
      // Kofi: Maths 15/30 + 50 → 20 + 30 = 50; English 50 + 50 → 50 → average 50
      [s.kofi]: { [s.math]: { classScore: 15, examScore: 50 }, [s.eng]: { classScore: 50, examScore: 50 } },
    } },
  })
  assert.equal(save.status, 200, JSON.stringify(save.data))

  const data = await cards()
  assert.equal(data.classSize, 3)
  assert.deepEqual(data.weights, { classScore: 40, exam: 60 })
  assert.equal(data.school.name, 'Gamma School')
  const ama = cardOf(data, s.ama)
  const kofi = cardOf(data, s.kofi)
  const esi = cardOf(data, s.esi)
  assert.deepEqual([ama.average, ama.position, ama.grade, ama.gradeRemark], [87, 1, 'HP', 'Highly Proficient'])
  assert.deepEqual([kofi.average, kofi.position, kofi.grade], [50, 2, 'D'])
  assert.deepEqual([esi.average, esi.position, esi.grade, esi.subjectsScored], [0, 3, 'E', 0])
  const amaMath = ama.rows.find((r) => r.subjectId === s.math)
  assert.deepEqual([amaMath.total, amaMath.position, amaMath.classScoreWeighted, amaMath.examScoreWeighted], [100, 1, 40, 60])
  assert.equal(ama.rows.find((r) => r.subjectId === s.eng).total, 74)
  assert.ok(!data.cards.some((c) => c.student._id === s.away), 'only this class')
})

test("the school's weight and scale change every card", async () => {
  assert.equal((await t.api('PUT', '/api/school/settings', { token: s.head, body: { classScoreWeight: 50 } })).status, 200)
  // Ama's English: 80 × 0.5 + 70 × 0.5 = 75; Maths stays 100 → average 87.5
  assert.equal(cardOf(await cards(), s.ama).average, 87.5)

  const presets = (await t.api('GET', '/api/school/grading-presets', { token: s.admin })).data
  const r = await t.api('PUT', '/api/school/settings', { token: s.admin, body: { gradingScale: { preset: 'wassce', bands: presets.wassce } } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const data = await cards()
  assert.equal(cardOf(data, s.ama).grade, 'A1')
  assert.equal(cardOf(data, s.kofi).grade, 'C5')
  await t.api('PUT', '/api/school/settings', { token: s.admin, body: { classScoreWeight: 40, gradingScale: { preset: 'nacca', bands: presets.nacca } } })
})

test("remarks: the class teacher writes theirs, only the head writes the head's", async () => {
  const put = (token, remarks) => t.api('PUT', `/api/reports/remarks/${s.cls}/1`, { token, body: { remarks } })
  const ok = await put(s.teacher, { [s.ama]: { conduct: 'Very good', attitude: 'Hardworking', interest: 'Reading', teacherRemark: 'Excellent work.', promotedTo: 'Basic 6' } })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  assert.equal((await put(s.teacher, { [s.ama]: { headRemark: 'Well done' } })).status, 403)
  assert.equal((await put(s.head, { [s.ama]: { headRemark: 'Keep it up.' } })).status, 200)
  assert.equal((await put(s.teacher, { [s.away]: { conduct: 'Good' } })).status, 400, 'pupil of another class')
  assert.equal((await put(s.teacher, { [s.kofi]: { teacherRemark: 'x'.repeat(301) } })).status, 400, 'too long')

  const map = (await t.api('GET', `/api/reports/remarks/${s.cls}/1`, { token: s.teacher })).data
  assert.equal(map[s.ama].conduct, 'Very good')
  assert.equal(map[s.ama].headRemark, 'Keep it up.')
  assert.deepEqual(cardOf(await cards(), s.ama).remarks, {
    conduct: 'Very good', attitude: 'Hardworking', interest: 'Reading',
    teacherRemark: 'Excellent work.', headRemark: 'Keep it up.', promotedTo: 'Basic 6',
  })
})

test("a student login sees only their own card", async () => {
  const u = await t.api('POST', '/api/users', { token: s.admin, body: { fullName: 'Kofi (pupil)', email: 'kofi@gamma.test', role: 'student', studentId: s.kofi } })
  assert.equal(u.status, 201, JSON.stringify(u.data))
  const tok = await t.firstLogin('kofi@gamma.test', u.data.credentials.password)
  const me = await t.api('GET', '/api/reports/me', { token: tok })
  assert.equal(me.status, 200, JSON.stringify(me.data))
  assert.equal(me.data.card.student.fullName, 'Kofi Annan')
  assert.deepEqual([me.data.card.position, me.data.classSize], [2, 3])
  assert.equal(me.data.cards, undefined)
  const raw = JSON.stringify(me.data)
  assert.ok(!raw.includes('Ama Owusu') && !raw.includes(s.ama), "no classmate's data")
  assert.equal((await t.api('GET', `/api/reports/cards/${s.cls}/1`, { token: tok })).status, 403)
  assert.equal((await t.api('GET', `/api/reports/remarks/${s.cls}/1`, { token: tok })).status, 403)
})
