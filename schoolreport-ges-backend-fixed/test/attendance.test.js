// Daily register: who may take and correct it, the term grid, and the report-card line.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApi, todayStr, daysAgo } from './helpers.js'

let t
const s = {}

before(async () => {
  t = await startApi()
  ;({ schoolId: s.schoolA, admin: s.admin } = await t.newSchool('Alpha'))
  ;({ admin: s.adminB } = await t.newSchool('Beta'))
  s.c4A = await t.newClass(s.admin, 'Class 4A')
  s.c4B = await t.newClass(s.admin, 'Class 4B')
  s.teacher = (await t.newUser(s.admin, { fullName: 'Ama Teacher', email: 'ama@alpha.test', role: 'teacher', classId: s.c4A })).token
  s.head = (await t.newUser(s.admin, { fullName: 'Kofi Head', email: 'head@alpha.test', role: 'head' })).token
  s.kwame = (await t.newPupil(s.admin, { fullName: 'Kwame Mensah', classId: s.c4A }))._id
  s.akosua = (await t.newPupil(s.admin, { fullName: 'Akosua Boateng', gender: 'F', classId: s.c4A }))._id
  s.yaw = (await t.newPupil(s.admin, { fullName: 'Yaw Owusu', classId: s.c4A }))._id
  s.esi = (await t.newPupil(s.admin, { fullName: 'Esi Asante', gender: 'F', classId: s.c4B }))._id
})

after(() => t.close())

const mark = (token, classId, day, marks) => t.api('PUT', `/api/attendance/${classId}/${day}`, { token, body: { marks } })

test("the class teacher takes today's register, and can correct it the same day", async () => {
  const today = todayStr()
  const empty = await t.api('GET', `/api/attendance/${s.c4A}?day=${today}`, { token: s.teacher })
  assert.equal(empty.status, 200, JSON.stringify(empty.data))
  assert.equal(empty.data.register, null)
  assert.equal(empty.data.canEdit, true)
  assert.deepEqual(empty.data.students.map((x) => x.fullName), ['Akosua Boateng', 'Kwame Mensah', 'Yaw Owusu'])
  assert.ok(empty.data.students.every((x) => x.status === null))

  const r = await mark(s.teacher, s.c4A, today, { [s.kwame]: 'present', [s.akosua]: 'absent', [s.yaw]: 'present' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.deepEqual([r.data.present, r.data.absent, r.data.unmarked], [2, 1, 0])

  const saved = await t.api('GET', `/api/attendance/${s.c4A}?day=${today}`, { token: s.teacher })
  assert.equal(saved.data.register.takenBy, 'Ama Teacher')
  assert.equal(saved.data.students.find((x) => x._id === s.akosua).status, 'absent')

  // Same day: the teacher may still correct it. Leaving a pupil out keeps their mark.
  const fix = await mark(s.teacher, s.c4A, today, { [s.yaw]: 'absent' })
  assert.equal(fix.status, 200)
  assert.deepEqual([fix.data.present, fix.data.absent], [1, 2])

  const audit = await t.query("SELECT action, details FROM audit_log WHERE action LIKE 'attendance.%' ORDER BY id")
  assert.deepEqual(audit.rows.map((a) => a.action), ['attendance.take', 'attendance.update'])
  assert.equal(audit.rows[1].details.changed[0].to, 'absent')
})

test('register input is checked', async () => {
  const today = todayStr()
  assert.equal((await mark(s.teacher, s.c4A, '2099-01-01', { [s.kwame]: 'present' })).status, 400, 'no future days')
  assert.equal((await mark(s.teacher, s.c4A, 'yesterday', { [s.kwame]: 'present' })).status, 400)
  assert.equal((await mark(s.teacher, s.c4A, today, { [s.kwame]: 'late' })).status, 400, 'present or absent only')
  assert.equal((await mark(s.teacher, s.c4A, today, {})).status, 400)
  assert.equal((await mark(s.admin, s.c4A, today, { [s.esi]: 'present' })).status, 400, 'pupil of another class')
  assert.equal((await mark(s.teacher, s.c4B, today, { [s.esi]: 'present' })).status, 403, "teacher: not another class")
  assert.equal((await t.api('GET', `/api/attendance/${s.c4A}`, { token: s.adminB })).status, 404, 'other school')
})

test('teachers can fill in the past week; older days and earlier registers need the head', async () => {
  const d3 = daysAgo(3)
  const d10 = daysAgo(10)
  assert.equal((await mark(s.teacher, s.c4A, d3, { [s.kwame]: 'present', [s.akosua]: 'present', [s.yaw]: 'absent' })).status, 200)
  assert.equal((await mark(s.teacher, s.c4A, d10, { [s.kwame]: 'present' })).status, 403, 'more than 7 days back')
  assert.equal((await mark(s.head, s.c4A, d10, { [s.kwame]: 'absent', [s.akosua]: 'present', [s.yaw]: 'present' })).status, 200)

  // A register first taken on an earlier day is closed to the teacher.
  await t.query("UPDATE attendance_registers SET created_at = now() - interval '2 days' WHERE day = $1", [d3])
  const view = await t.api('GET', `/api/attendance/${s.c4A}?day=${d3}`, { token: s.teacher })
  assert.equal(view.data.canEdit, false)
  assert.equal((await mark(s.teacher, s.c4A, d3, { [s.yaw]: 'present' })).status, 403)
  assert.equal((await mark(s.head, s.c4A, d3, { [s.yaw]: 'present' })).status, 200, 'the head can correct it')
})

test("overview of today's registers, the term grid and the report-card line", async () => {
  const ov = await t.api('GET', '/api/attendance/overview', { token: s.head })
  assert.equal(ov.status, 200)
  const a = ov.data.classes.find((c) => c.classId === s.c4A)
  const b = ov.data.classes.find((c) => c.classId === s.c4B)
  assert.deepEqual([a.taken, a.present, a.absent, a.studentCount], [true, 1, 2, 3])
  assert.equal(b.taken, false)
  assert.equal((await t.api('GET', '/api/attendance/overview', { token: s.teacher })).status, 403)

  const grid = await t.api('GET', `/api/attendance/${s.c4A}/register`, { token: s.teacher })
  assert.equal(grid.status, 200, JSON.stringify(grid.data))
  assert.deepEqual(grid.data.days, [daysAgo(10), daysAgo(3), todayStr()])
  const kwame = grid.data.students.find((x) => x._id === s.kwame)
  assert.deepEqual([kwame.present, kwame.absent, kwame.total], [2, 1, 3])
  assert.equal(kwame.marks[daysAgo(10)], 'A')

  // The terminal report shows "attendance: present out of days the register was taken".
  const cards = await t.api('GET', `/api/reports/cards/${s.c4A}/1`, { token: s.admin })
  assert.equal(cards.status, 200, JSON.stringify(cards.data))
  assert.deepEqual(cards.data.cards.find((c) => c.student._id === s.kwame).attendance, { present: 2, total: 3 })
  assert.deepEqual(cards.data.cards.find((c) => c.student._id === s.yaw).attendance, { present: 2, total: 3 })
})

test('only the head or admin can delete a register', async () => {
  const d10 = daysAgo(10)
  assert.equal((await t.api('DELETE', `/api/attendance/${s.c4A}/${d10}`, { token: s.teacher })).status, 403)
  assert.equal((await t.api('DELETE', `/api/attendance/${s.c4A}/${d10}`, { token: s.head })).status, 200)
  assert.equal((await t.api('DELETE', `/api/attendance/${s.c4A}/${d10}`, { token: s.head })).status, 404)
  const grid = await t.api('GET', `/api/attendance/${s.c4A}/register`, { token: s.admin })
  assert.equal(grid.data.days.length, 2)
})
