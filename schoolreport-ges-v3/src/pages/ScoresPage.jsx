import { Fragment, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useSchoolStore } from '@/store/schoolStore'
import api, { errorMessage } from '@/lib/api'
import { Card, SectionHeader, Button, Select, Alert, Spinner, EmptyState, PageHeader } from '@/components/ui'
import { Save, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

function getGrade(total) {
  const t = parseFloat(total)
  if (isNaN(t)) return { g: '—', cls: 'text-gray-400' }
  if (t >= 80) return { g: 'A1', cls: 'text-green font-bold' }
  if (t >= 70) return { g: 'B2', cls: 'text-green' }
  if (t >= 60) return { g: 'B3', cls: 'text-blue' }
  if (t >= 55) return { g: 'C4', cls: 'text-blue' }
  if (t >= 50) return { g: 'C5', cls: 'text-amber' }
  if (t >= 45) return { g: 'C6', cls: 'text-amber' }
  if (t >= 40) return { g: 'D7', cls: 'text-red' }
  if (t >= 35) return { g: 'E8', cls: 'text-red' }
  return { g: 'F9', cls: 'text-red font-bold' }
}

/** A typed value is out of range if it is not a number between 0 and max. Empty is fine. */
const outOfRange = (v, max) => v !== '' && v !== undefined && v !== null &&
  (isNaN(parseFloat(v)) || parseFloat(v) < 0 || parseFloat(v) > max)

export default function ScoresPage() {
  const { user } = useAuthStore()
  const { classes, subjects, settings, fetchClasses, fetchSubjects } = useSchoolStore()
  const isTeacher = user?.role === 'teacher'
  const [pickedClass, setPickedClass] = useState('')
  const selectedClass = isTeacher ? (user?.classId || '') : pickedClass
  const [term, setTerm] = useState(settings?.term || '1')
  const termTouched = useRef(false)
  const [students, setStudents] = useState([])
  const [scores, setScores] = useState({})
  const [maxMarks, setMaxMarks] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  // Mobile: show one subject at a time
  const [subjectIdx, setSubjectIdx] = useState(0)

  useEffect(() => { fetchClasses(); fetchSubjects() }, [])

  // Start on the school's current term once settings arrive (unless the user already picked one).
  useEffect(() => {
    if (settings?.term && !termTouched.current) setTerm(settings.term)
  }, [settings?.term])

  useEffect(() => {
    if (subjectIdx >= subjects.length) setSubjectIdx(0)
  }, [subjects.length])

  // Warn before closing the tab with unsaved scores.
  useEffect(() => {
    if (!dirty) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    if (!selectedClass) return
    setLoading(true)
    Promise.all([
      api.get('/students', { params: { classId: selectedClass } }),
      api.get(`/scores/${selectedClass}/${term}`),
      api.get('/school/max-marks'),
    ]).then(([studRes, scoreRes, marksRes]) => {
      setStudents(studRes.data)
      const map = {}
      studRes.data.forEach(s => { map[s._id] = {} })
      scoreRes.data.forEach(entry => {
        if (!map[entry.studentId]) return // e.g. a student since moved to another class
        map[entry.studentId][entry.subjectId] = { classScore: entry.classScore, examScore: entry.examScore }
      })
      setScores(map)
      setMaxMarks(marksRes.data)
      setDirty(false)
    }).catch((err) => toast.error(errorMessage(err, 'Failed to load scores')))
      .finally(() => setLoading(false))
  }, [selectedClass, term])

  const confirmDiscard = () => !dirty || confirm('You have unsaved scores. Discard them?')

  const changeClass = (id) => { if (confirmDiscard()) setPickedClass(id) }
  const changeTerm = (t) => {
    if (!confirmDiscard()) return
    termTouched.current = true
    setTerm(t)
  }

  const update = (studentId, subjectId, field, val) => {
    setDirty(true)
    setScores(s => ({
      ...s,
      [studentId]: { ...s[studentId], [subjectId]: { ...(s[studentId]?.[subjectId] || {}), [field]: val } }
    }))
  }

  const maxFor = (subjectId) => maxMarks[subjectId] || 100

  const calcTotal = (studentId, subjectId) => {
    const entry = scores[studentId]?.[subjectId]
    if (!entry || ((entry.classScore ?? '') === '' && (entry.examScore ?? '') === '')) return '—'
    const csConverted = (parseFloat(entry.classScore || 0) / maxFor(subjectId)) * 40
    const esConverted = (parseFloat(entry.examScore || 0) / 100) * 60
    return (csConverted + esConverted).toFixed(1)
  }

  const saveAll = async () => {
    // Catch out-of-range marks here so the teacher sees exactly which ones to fix.
    const problems = []
    for (const st of students) {
      for (const sub of subjects) {
        const e = scores[st._id]?.[sub._id]
        if (!e) continue
        if (outOfRange(e.classScore, maxFor(sub._id))) problems.push(`${st.fullName} – ${sub.name} class score (max ${maxFor(sub._id)})`)
        if (outOfRange(e.examScore, 100)) problems.push(`${st.fullName} – ${sub.name} exam score (max 100)`)
      }
    }
    if (problems.length) {
      toast.error(`Fix ${problems.length} out-of-range mark(s) first: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '…' : ''}`, { duration: 6000 })
      return
    }

    setSaving(true)
    try {
      const { data } = await api.post(`/scores/${selectedClass}/${term}/bulk`, { scores })
      setDirty(false)
      toast.success(data.cleared ? `Scores saved (${data.cleared} cleared)` : 'Scores saved!')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save scores'), { duration: 6000 })
    } finally { setSaving(false) }
  }

  const currentSubject = subjects[subjectIdx]

  const scoreInput = (s, sub, field, max) => {
    const value = scores[s._id]?.[sub._id]?.[field] ?? ''
    return (
      <input
        type="number" min="0" max={max} step="0.5" value={value} inputMode="decimal"
        aria-label={`${s.fullName} ${sub.name} ${field === 'classScore' ? 'class' : 'exam'} score`}
        onChange={e => update(s._id, sub._id, field, e.target.value)}
        className={clsx('si', outOfRange(value, max) && 'over')}
      />
    )
  }

  if (isTeacher && !user?.classId) {
    return (
      <div>
        <PageHeader title="Score Entry" subtitle="Class Score (40%) + Exam Score (60%) = Total" />
        <Card><EmptyState icon={BookOpen} title="No class assigned" description="Ask your school admin to assign you a class." /></Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Score Entry" subtitle="Class Score (40%) + Exam Score (60%) = Total" />

      <Alert variant="info">
        📌 Class Score uses your configured max mark per subject. Exam score is always out of 100.
        Clearing both boxes for a subject and saving removes that score.
      </Alert>

      {/* Controls */}
      <Card>
        <SectionHeader title={settings?.academicYear ? `Class & Term · ${settings.academicYear}` : 'Class & Term'}>
          <div className="flex flex-wrap gap-2">
            {!isTeacher && (
              <Select className="w-36 sm:w-44" value={selectedClass} onChange={e => changeClass(e.target.value)}>
                <option value="">Select class…</option>
                {classes.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </Select>
            )}
            <Select className="w-28 sm:w-32" value={term} onChange={e => changeTerm(e.target.value)}>
              <option value="1">Term 1</option>
              <option value="2">Term 2</option>
              <option value="3">Term 3</option>
            </Select>
          </div>
        </SectionHeader>
      </Card>

      {!selectedClass ? (
        <Card><EmptyState icon={BookOpen} title="No class selected" description="Select a class above to begin score entry." /></Card>
      ) : loading ? <Spinner /> : students.length === 0 ? (
        <Card><EmptyState icon={BookOpen} title="No students in this class" description="Add students first." /></Card>
      ) : subjects.length === 0 ? (
        <Card><EmptyState icon={BookOpen} title="No subjects configured" description="Add subjects in Settings." /></Card>
      ) : (
        <>
          {/* ── MOBILE VIEW: one subject at a time ── */}
          <div className="block xl:hidden">
            <Card>
              {/* Subject navigator */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setSubjectIdx(i => Math.max(0, i - 1))}
                  disabled={subjectIdx === 0}
                  aria-label="Previous subject"
                  className="p-2 rounded-lg border border-border disabled:opacity-30 hover:bg-blue-light transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-center">
                  <div className="font-bold text-blue text-sm">{currentSubject?.name}</div>
                  <div className="text-xs text-gray-400">Subject {subjectIdx + 1} of {subjects.length}</div>
                </div>
                <button
                  onClick={() => setSubjectIdx(i => Math.min(subjects.length - 1, i + 1))}
                  disabled={subjectIdx === subjects.length - 1}
                  aria-label="Next subject"
                  className="p-2 rounded-lg border border-border disabled:opacity-30 hover:bg-blue-light transition-all"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Score legend */}
              {currentSubject && (
                <div className="flex gap-3 text-[11px] text-gray-500 mb-3 bg-[#f8faff] rounded-lg px-3 py-2">
                  <span>CS = Class Score (max {maxFor(currentSubject._id)})</span>
                  <span>ES = Exam Score (/100)</span>
                </div>
              )}

              {/* Student rows for current subject */}
              <div className="space-y-2">
                {currentSubject && students.map((s, i) => {
                  const sub = currentSubject
                  const tot = calcTotal(s._id, sub._id)
                  const grade = getGrade(tot)
                  return (
                    <div key={s._id} className="flex items-center gap-3 p-3 bg-[#f8faff] rounded-xl">
                      <div className="w-6 h-6 bg-blue-light rounded-full flex items-center justify-center text-[10px] font-bold text-blue flex-shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 text-sm font-medium truncate">{s.fullName}</div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] text-gray-400 mb-0.5">CS</span>
                          {scoreInput(s, sub, 'classScore', maxFor(sub._id))}
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] text-gray-400 mb-0.5">ES</span>
                          {scoreInput(s, sub, 'examScore', 100)}
                        </div>
                        <div className="flex flex-col items-center min-w-[36px]">
                          <span className="text-[9px] text-gray-400 mb-0.5">Total</span>
                          <span className={clsx('text-xs font-bold', grade.cls)}>{tot}</span>
                          <span className={clsx('text-[10px]', grade.cls)}>{grade.g}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>

          {/* ── DESKTOP VIEW: full table ── */}
          <div className="hidden xl:block">
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="text-left px-2 py-2 bg-[#f0f4fb] border border-border sticky left-0 z-10 min-w-[180px] font-bold text-[11px] text-gray-500 uppercase">Student</th>
                      {subjects.map(sub => (
                        <th key={sub._id} className="px-1 py-2 bg-[#f0f4fb] border border-border text-center min-w-[150px] font-bold text-[11px] text-gray-700" colSpan={3}>
                          {sub.name}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th className="px-2 py-1 bg-[#f0f4fb] border border-border sticky left-0 z-10" />
                      {subjects.map(sub => (
                        <Fragment key={sub._id}>
                          <th className="px-1 py-1 bg-[#f0f4fb] border border-border text-center text-[10px] text-gray-400 font-normal">CS/{maxFor(sub._id)}</th>
                          <th className="px-1 py-1 bg-[#f0f4fb] border border-border text-center text-[10px] text-gray-400 font-normal">ES/100</th>
                          <th className="px-1 py-1 bg-[#f0f4fb] border border-border text-center text-[10px] text-gray-400 font-normal">Tot/Grd</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, i) => (
                      <tr key={s._id} className="hover:bg-[#f8faff]">
                        <td className="px-2 py-1.5 border border-[#f0f4fb] font-medium sticky left-0 bg-white z-10 text-[12px]">
                          <span className="text-gray-400 mr-1">{i + 1}.</span>{s.fullName}
                        </td>
                        {subjects.map(sub => {
                          const tot = calcTotal(s._id, sub._id)
                          const grade = getGrade(tot)
                          return (
                            <Fragment key={sub._id}>
                              <td className="px-1 py-1 border border-[#f0f4fb] text-center">
                                {scoreInput(s, sub, 'classScore', maxFor(sub._id))}
                              </td>
                              <td className="px-1 py-1 border border-[#f0f4fb] text-center">
                                {scoreInput(s, sub, 'examScore', 100)}
                              </td>
                              <td className="px-1 py-1 border border-[#f0f4fb] text-center">
                                <span className={clsx('text-xs', grade.cls)}>{tot}</span>
                                {grade.g !== '—' && <span className={clsx('ml-1 text-[10px] font-bold', grade.cls)}>{grade.g}</span>}
                              </td>
                            </Fragment>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Save button — always visible */}
          <div className="sticky bottom-4 flex justify-end items-center gap-3">
            {dirty && <span className="text-xs text-amber bg-amber-light px-2 py-1 rounded">Unsaved changes</span>}
            <Button variant="success" size="lg" onClick={saveAll} disabled={saving}
              className="shadow-lg shadow-green/30">
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save All Scores'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
