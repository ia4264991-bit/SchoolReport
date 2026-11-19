import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { useSchoolStore } from '@/store/schoolStore'
import api, { errorMessage } from '@/lib/api'
import { shortDate, formatDate, todayIso } from '@/lib/format'
import { queueRegister, isOffline, cacheRoster, cachedRoster, pendingRegisters, syncRegisters } from '@/lib/offline'
import { Card, SectionHeader, Button, Select, Input, Spinner, EmptyState, Alert, Badge, PageHeader } from '@/components/ui'
import { ClipboardCheck, Check, X, ChevronLeft, List, Printer, WifiOff, Send, Users } from 'lucide-react'

const initials = (name) => name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

/* ── Roll call: one pupil at a time, full screen ─────────────────────────── */
function RollCall({ students, marks, setMark, className, day, onDone, onClose, onList }) {
  const firstUnmarked = students.findIndex((s) => !marks[s._id])
  const [i, setI] = useState(firstUnmarked === -1 ? 0 : firstUnmarked)
  const [flash, setFlash] = useState(null)
  const done = i >= students.length
  const pupil = students[Math.min(i, students.length - 1)]
  const present = students.filter((s) => marks[s._id] === 'present').length
  const absentList = students.filter((s) => marks[s._id] === 'absent')

  const choose = useCallback((status) => {
    if (done) return
    setMark(pupil._id, status)
    setFlash(status)
    setTimeout(() => { setFlash(null); setI((n) => n + 1) }, 160)
  }, [done, pupil, setMark])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'p' || e.key === 'P' || e.key === 'ArrowRight') choose('present')
      else if (e.key === 'a' || e.key === 'A') choose('absent')
      else if (e.key === 'ArrowLeft' || e.key === 'Backspace') setI((n) => Math.max(0, n - 1))
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choose, onClose])

  return (
    <div className="fixed inset-0 z-[60] bg-[#f4f7fc] flex flex-col" role="dialog" aria-modal="true" aria-label="Take attendance">
      {/* Top bar */}
      <div className="bg-blue text-white px-4 pt-3 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <button onClick={onClose} className="p-2 -ml-2 rounded-lg hover:bg-white/10" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
          <div className="text-center min-w-0">
            <div className="font-bold text-[15px] truncate">{className}</div>
            <div className="text-[11px] opacity-80">{shortDate(day)}</div>
          </div>
          <button onClick={onList} className="p-2 -mr-2 rounded-lg hover:bg-white/10 flex items-center gap-1 text-xs font-semibold" aria-label="Switch to list">
            <List className="w-5 h-5" /><span className="hidden sm:inline">List</span>
          </button>
        </div>
        <div className="mt-3 h-1.5 bg-white/25 rounded-full overflow-hidden">
          <div className="h-full bg-white rounded-full transition-all duration-200" style={{ width: `${(Math.min(i, students.length) / students.length) * 100}%` }} />
        </div>
        <div className="text-[11px] mt-1.5 text-center opacity-90">
          {done ? `All ${students.length} pupils marked` : `${i + 1} of ${students.length}`}
        </div>
      </div>

      {!done ? (
        <>
          <div className={clsx('flex-1 flex flex-col items-center justify-center px-6 text-center transition-colors duration-150',
            flash === 'present' && 'bg-green-light', flash === 'absent' && 'bg-red-light')}>
            <div className={clsx('w-24 h-24 sm:w-28 sm:h-28 rounded-full flex items-center justify-center text-3xl font-bold mb-5',
              pupil.gender === 'F' ? 'bg-amber-light text-amber' : 'bg-blue-light text-blue')}>
              {initials(pupil.fullName)}
            </div>
            <div className="text-[28px] sm:text-4xl font-bold text-gray-900 leading-tight break-words max-w-full">{pupil.fullName}</div>
            {marks[pupil._id] && (
              <div className="mt-3 text-sm text-gray-500">
                Marked <strong className={marks[pupil._id] === 'present' ? 'text-green' : 'text-red'}>{marks[pupil._id]}</strong> — tap again to change
              </div>
            )}
          </div>

          <div className="px-4 pb-4 pt-2 flex-shrink-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            <div className="grid grid-cols-2 gap-3 max-w-xl mx-auto">
              <button onClick={() => choose('present')}
                className={clsx('min-h-[96px] rounded-2xl text-white text-xl font-bold flex flex-col items-center justify-center gap-1 shadow-lg active:scale-[0.97] transition-transform',
                  'bg-[#2e8b3a] hover:bg-[#27762f]', marks[pupil._id] === 'present' && 'ring-4 ring-green-200')}>
                <Check className="w-8 h-8" strokeWidth={3} /> Present
              </button>
              <button onClick={() => choose('absent')}
                className={clsx('min-h-[96px] rounded-2xl text-white text-xl font-bold flex flex-col items-center justify-center gap-1 shadow-lg active:scale-[0.97] transition-transform',
                  'bg-[#c0392b] hover:bg-[#a93226]', marks[pupil._id] === 'absent' && 'ring-4 ring-red-200')}>
                <X className="w-8 h-8" strokeWidth={3} /> Absent
              </button>
            </div>
            <div className="flex justify-between items-center max-w-xl mx-auto mt-3">
              <button onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}
                className="flex items-center gap-1 text-sm font-semibold text-gray-500 px-3 py-2 rounded-lg disabled:opacity-30 hover:bg-white">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <span className="text-xs text-gray-400">{present} present · {absentList.length} absent</span>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-xl mx-auto">
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-green-light rounded-2xl p-4 text-center">
                <div className="text-4xl font-bold text-green">{present}</div>
                <div className="text-xs text-green font-semibold mt-1">Present</div>
              </div>
              <div className="bg-red-light rounded-2xl p-4 text-center">
                <div className="text-4xl font-bold text-red">{absentList.length}</div>
                <div className="text-xs text-red font-semibold mt-1">Absent</div>
              </div>
            </div>
            {absentList.length > 0 && (
              <div className="bg-white rounded-2xl border border-border p-4 mb-5">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Absent today — tap a name to change</div>
                {absentList.map((s) => (
                  <button key={s._id} onClick={() => setMark(s._id, 'present')}
                    className="w-full text-left py-2.5 border-b border-[#f0f4fb] last:border-0 flex items-center justify-between text-sm font-medium">
                    {s.fullName}<Badge variant="red">Absent</Badge>
                  </button>
                ))}
              </div>
            )}
            <button onClick={onDone} className="w-full min-h-[56px] rounded-2xl bg-blue text-white text-lg font-bold shadow-lg active:scale-[0.98]">
              Save register
            </button>
            <button onClick={() => setI(0)} className="w-full mt-3 py-3 text-sm font-semibold text-gray-500">Go through the names again</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── The page ───────────────────────────────────────────────────────────── */
export default function AttendancePage() {
  const { user } = useAuthStore()
  const { classes, fetchClasses } = useSchoolStore()
  const navigate = useNavigate()
  const isTeacher = user?.role === 'teacher'
  const [picked, setPicked] = useState('')
  const classId = isTeacher ? (user?.classId || '') : picked
  const [day, setDay] = useState(todayIso())
  const [data, setData] = useState(null)
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(false)
  const [marks, setMarks] = useState({})
  const [mode, setMode] = useState(null) // null | 'rollcall' | 'list'
  const [saving, setSaving] = useState(false)
  const [overview, setOverview] = useState(null)
  const [pending, setPending] = useState(pendingRegisters())

  useEffect(() => { if (!isTeacher) fetchClasses() }, [isTeacher])
  useEffect(() => {
    const onQ = () => setPending(pendingRegisters())
    window.addEventListener('sr-queue-changed', onQ)
    return () => window.removeEventListener('sr-queue-changed', onQ)
  }, [])

  const loadOverview = useCallback(() => {
    if (isTeacher) return
    api.get('/attendance/overview', { params: { day } }).then((r) => setOverview(r.data)).catch(() => {})
  }, [isTeacher, day])
  useEffect(loadOverview, [loadOverview])

  const load = useCallback(async () => {
    if (!classId) { setData(null); return }
    setLoading(true)
    try {
      const { data: d } = await api.get(`/attendance/${classId}`, { params: { day } })
      setData(d)
      setOffline(false)
      setMarks(Object.fromEntries(d.students.filter((s) => s.status).map((s) => [s._id, s.status])))
      cacheRoster(classId, { class: d.class, students: d.students.map(({ _id, fullName, gender }) => ({ _id, fullName, gender })) })
    } catch (err) {
      const cached = isOffline(err) ? cachedRoster(classId) : null
      if (cached) {
        const queued = pendingRegisters().find((r) => r.classId === classId && r.day === day)
        setData({ day, class: cached.class, register: null, canEdit: true, students: cached.students.map((s) => ({ ...s, status: null })) })
        setMarks(queued?.marks || {})
        setOffline(true)
      } else {
        setData(null)
        toast.error(errorMessage(err, 'Could not load the class list'))
      }
    } finally {
      setLoading(false)
    }
  }, [classId, day])
  useEffect(() => { load() }, [load])

  const students = data?.students || []
  const setMark = useCallback((id, status) => setMarks((m) => ({ ...m, [id]: status })), [])
  const counts = useMemo(() => {
    const present = students.filter((s) => marks[s._id] === 'present').length
    const absent = students.filter((s) => marks[s._id] === 'absent').length
    return { present, absent, unmarked: students.length - present - absent }
  }, [students, marks])

  const save = async () => {
    const toSend = Object.fromEntries(students.filter((s) => marks[s._id]).map((s) => [s._id, marks[s._id]]))
    if (!Object.keys(toSend).length) return toast.error('Mark at least one pupil first.')
    if (counts.unmarked > 0 && !confirm(`${counts.unmarked} pupil(s) are not marked yet. Save anyway?`)) return
    setSaving(true)
    try {
      const { data: r } = await api.put(`/attendance/${classId}/${day}`, { marks: toSend })
      toast.success(`${r.message} ${r.present} present, ${r.absent} absent.`)
      setMode(null)
      await load()
      loadOverview()
    } catch (err) {
      if (isOffline(err)) {
        queueRegister({ classId, className: data?.class?.name || '', day, marks: toSend })
        toast.success('No network — the register is saved on this phone and will be sent when you are back online.', { duration: 6000 })
        setMode(null)
      } else {
        toast.error(errorMessage(err, 'Could not save the register'))
      }
    } finally {
      setSaving(false)
    }
  }

  const sendPending = async () => {
    const r = await syncRegisters()
    if (r.sent) toast.success(`${r.sent} register(s) sent.`)
    r.failed.forEach((f) => toast.error(`${f.className} ${shortDate(f.day)}: ${f.error}`, { duration: 8000 }))
    if (r.left) toast.error('Still no connection. They will be sent automatically later.')
    load()
  }

  const startRollCall = () => {
    if (!students.length) return toast.error('There are no pupils in this class yet.')
    setMode('rollcall')
  }
  const markAll = (status) => setMarks(Object.fromEntries(students.map((s) => [s._id, status])))
  const readOnly = data && !data.canEdit
  const isToday = day === todayIso()

  if (isTeacher && !user?.classId) {
    return (
      <div>
        <PageHeader title="Attendance" subtitle="Daily class register" />
        <Card><EmptyState icon={ClipboardCheck} title="No class assigned" description="Ask your school admin to assign you a class." /></Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Daily class register — once a day, present or absent">
        {classId && (
          <Button size="sm" onClick={() => navigate(`/printouts?what=register&classId=${classId}`)}>
            <Printer className="w-3.5 h-3.5" /> Term register
          </Button>
        )}
      </PageHeader>

      {pending.length > 0 && (
        <Alert variant="warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><WifiOff className="w-3.5 h-3.5 inline mr-1" />{pending.length} register(s) waiting to be sent: {pending.map((p) => `${p.className} (${shortDate(p.day)})`).join(', ')}</span>
            <Button size="sm" variant="warn" onClick={sendPending}><Send className="w-3.5 h-3.5" /> Send now</Button>
          </div>
        </Alert>
      )}

      {!isTeacher && overview && (
        <Card>
          <SectionHeader title={`Registers for ${isToday ? 'today' : shortDate(day)}: ${overview.classes.filter((c) => c.taken).length} of ${overview.classes.length} classes`} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {overview.classes.map((c) => (
              <button key={c.classId} onClick={() => setPicked(c.classId)}
                className={clsx('text-left rounded-xl border p-3 transition-colors',
                  c.classId === classId ? 'border-blue bg-blue-light' : 'border-border bg-white hover:border-blue')}>
                <div className="font-semibold text-sm text-gray-800 truncate">{c.className}</div>
                {c.taken
                  ? <div className="text-[11px] text-green mt-0.5">✓ {c.present} present · {c.absent} absent</div>
                  : <div className="text-[11px] text-amber mt-0.5">Not taken yet · {c.studentCount} pupils</div>}
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <SectionHeader title={data?.class ? `${data.class.name} · ${formatDate(day)}` : 'Class register'}>
          {!isTeacher && (
            <Select className="w-40" value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="Class">
              <option value="">Select class…</option>
              {classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
          )}
          <Input type="date" className="w-40" value={day} max={todayIso()} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" />
        </SectionHeader>

        {!classId ? (
          <EmptyState icon={ClipboardCheck} title="Choose a class" description="Pick a class above, or tap one in the list." />
        ) : loading ? <Spinner /> : !data ? null : students.length === 0 ? (
          <EmptyState icon={Users} title="No pupils in this class" description="Add pupils on the Students page first." />
        ) : (
          <>
            {offline && <Alert variant="warn">No network: using the class list saved on this phone. The register will be sent when you are back online.</Alert>}
            {data.register && (
              <Alert variant={readOnly ? 'info' : 'ok'}>
                Register taken by <strong>{data.register.takenBy}</strong>.
                {readOnly ? ' It was taken on an earlier day — only the head teacher or admin can change it now.' : ' You can still correct it today.'}
              </Alert>
            )}

            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="rounded-xl bg-green-light p-3 text-center"><div className="text-2xl font-bold text-green">{counts.present}</div><div className="text-[11px] text-green">Present</div></div>
              <div className="rounded-xl bg-red-light p-3 text-center"><div className="text-2xl font-bold text-red">{counts.absent}</div><div className="text-[11px] text-red">Absent</div></div>
              <div className="rounded-xl bg-gray-100 p-3 text-center"><div className="text-2xl font-bold text-gray-600">{counts.unmarked}</div><div className="text-[11px] text-gray-500">Not marked</div></div>
            </div>

            {!readOnly && mode !== 'list' && (
              <div className="flex flex-col sm:flex-row gap-2 mb-2">
                <button onClick={startRollCall}
                  className="flex-1 min-h-[64px] rounded-2xl bg-blue text-white text-lg font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue/20 active:scale-[0.98]">
                  <ClipboardCheck className="w-6 h-6" /> {data.register ? 'Go through the names again' : 'Take attendance'}
                </button>
                <Button size="lg" onClick={() => setMode('list')}><List className="w-4 h-4" /> Quick list</Button>
              </div>
            )}

            {(mode === 'list' || readOnly || data.register) && (
              <div className="mt-3">
                {mode === 'list' && !readOnly && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    <Button size="sm" variant="success" onClick={() => markAll('present')}><Check className="w-3.5 h-3.5" /> Mark everyone present</Button>
                    <span className="text-xs text-gray-400 self-center">then tap the absent pupils</span>
                  </div>
                )}
                <div className="divide-y divide-[#f0f4fb] border border-border rounded-xl overflow-hidden bg-white">
                  {students.map((s, n) => {
                    const st = marks[s._id]
                    return (
                      <div key={s._id} className="flex items-center gap-3 px-3 py-2.5">
                        <span className="text-xs text-gray-300 w-5 text-right">{n + 1}</span>
                        <span className="flex-1 text-sm font-medium text-gray-800 truncate">{s.fullName}</span>
                        {readOnly || mode !== 'list' ? (
                          st ? <Badge variant={st === 'present' ? 'green' : 'red'}>{st === 'present' ? 'Present' : 'Absent'}</Badge> : <Badge variant="gray">—</Badge>
                        ) : (
                          <div className="flex rounded-lg overflow-hidden border border-border">
                            <button onClick={() => setMark(s._id, 'present')} aria-pressed={st === 'present'}
                              className={clsx('px-3 py-2 text-xs font-bold min-w-[44px]', st === 'present' ? 'bg-[#2e8b3a] text-white' : 'bg-white text-gray-400')}>P</button>
                            <button onClick={() => setMark(s._id, 'absent')} aria-pressed={st === 'absent'}
                              className={clsx('px-3 py-2 text-xs font-bold min-w-[44px] border-l border-border', st === 'absent' ? 'bg-[#c0392b] text-white' : 'bg-white text-gray-400')}>A</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {mode === 'list' && !readOnly && (
                  <div className="flex gap-2 mt-3 justify-end">
                    <Button onClick={() => { setMode(null); load() }}>Cancel</Button>
                    <Button variant="primary" size="lg" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save register'}</Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {mode === 'rollcall' && data && (
        <RollCall
          students={students}
          marks={marks}
          setMark={setMark}
          className={data.class?.name}
          day={day}
          onDone={save}
          onList={() => setMode('list')}
          onClose={() => { if (confirm('Close without saving? Your marks so far are kept on this screen.')) setMode(null) }}
        />
      )}
    </div>
  )
}
