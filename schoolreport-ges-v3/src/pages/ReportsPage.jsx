import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { useSchoolStore } from '@/store/schoolStore'
import { useAuthStore } from '@/store/authStore'
import api, { errorMessage } from '@/lib/api'
import { ordinal } from '@/lib/format'
import ReportSheet from '@/components/report/ReportSheet'
import { Card, SectionHeader, Button, Select, Table, Tr, Td, Badge, Spinner, EmptyState, Input, Alert } from '@/components/ui'
import { FileText, Printer, ChevronRight, Save, Sparkles, MessageSquareText } from 'lucide-react'

const SUGGEST = {
  conduct: ['Very good', 'Good', 'Satisfactory', 'Needs improvement'],
  attitude: ['Hardworking', 'Attentive', 'Respectful', 'Cheerful', 'Needs encouragement'],
  interest: ['Reading', 'Mathematics', 'Science', 'Sports', 'Music', 'Art', 'Drama'],
}
function suggestedRemark(avg) {
  if (avg >= 80) return 'Excellent performance. Keep it up!'
  if (avg >= 68) return 'Very good work. Keep it up.'
  if (avg >= 54) return 'Good effort. You can do even better.'
  if (avg >= 40) return 'Fair performance. Needs to work harder.'
  return 'Needs a lot more effort and support at home.'
}

export default function ReportsPage() {
  const { user } = useAuthStore()
  const { classes, fetchClasses, settings, logoUrl } = useSchoolStore()
  const navigate = useNavigate()
  const isTeacher = user?.role === 'teacher'
  const canHeadRemark = user?.role === 'admin' || user?.role === 'head'
  const [picked, setPicked] = useState('')
  const classId = isTeacher ? (user?.classId || '') : picked
  const [term, setTerm] = useState(settings?.term || '1')
  const termTouched = useRef(false)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('cards')
  const [selected, setSelected] = useState(null)
  const [remarks, setRemarks] = useState({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchClasses() }, [])
  useEffect(() => { if (settings?.term && !termTouched.current) setTerm(settings.term) }, [settings?.term])

  const load = async () => {
    if (!classId) { setReport(null); return }
    setLoading(true)
    setSelected(null)
    try {
      const { data } = await api.get(`/reports/cards/${classId}/${term}`)
      setReport(data)
      setRemarks(Object.fromEntries(data.cards.map((c) => [c.student._id, { ...c.remarks }])))
      setDirty(false)
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to load reports'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [classId, term])

  const card = useMemo(() => report?.cards.find((c) => c.student._id === selected), [report, selected])
  const editable = settings && report && report.academicYear === settings.academicYear

  const setRemark = (id, field, value) => {
    setRemarks((r) => ({ ...r, [id]: { ...r[id], [field]: value } }))
    setDirty(true)
  }
  const suggestAll = () => {
    let n = 0
    setRemarks((r) => {
      const next = { ...r }
      for (const c of report.cards) {
        if (!next[c.student._id]?.teacherRemark && c.subjectsScored) {
          next[c.student._id] = { ...next[c.student._id], teacherRemark: suggestedRemark(c.average) }
          n++
        }
      }
      return next
    })
    setDirty(true)
    setTimeout(() => toast.success(n ? `Suggested a remark for ${n} pupil(s). Read and adjust before saving.` : 'Every pupil with marks already has a remark.'), 0)
  }
  const saveRemarks = async () => {
    const body = Object.fromEntries(Object.entries(remarks).map(([id, r]) => {
      const { headRemark, ...rest } = r
      return [id, canHeadRemark ? r : rest]
    }))
    setSaving(true)
    try {
      const { data } = await api.put(`/reports/remarks/${classId}/${term}`, { remarks: body })
      toast.success(data.message)
      await load()
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the remarks'))
    } finally {
      setSaving(false)
    }
  }

  const changeTerm = (t) => {
    if (dirty && !confirm('You have unsaved remarks. Change term anyway?')) return
    termTouched.current = true
    setTerm(t)
  }

  if (isTeacher && !user?.classId) {
    return <Card><EmptyState icon={FileText} title="No class assigned" description="Ask your school admin to assign you a class." /></Card>
  }

  return (
    <div>
      <div className="mb-5 no-print">
        <h1 className="text-xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-400">Terminal reports, remarks and printing</p>
      </div>

      <Card className="no-print">
        <SectionHeader title={report ? `${report.class.name} · Term ${report.term}, ${report.academicYear}` : 'Select class & term'}>
          {!isTeacher && (
            <Select className="w-40" value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="Class">
              <option value="">Select class…</option>
              {classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
          )}
          <Select className="w-28" value={term} onChange={(e) => changeTerm(e.target.value)} aria-label="Term">
            <option value="1">Term 1</option><option value="2">Term 2</option><option value="3">Term 3</option>
          </Select>
          {report && (
            <Button size="sm" variant="primary" onClick={() => navigate(`/printouts?what=reports&classId=${classId}&term=${term}`)}>
              <Printer className="w-3.5 h-3.5" /> Print all
            </Button>
          )}
        </SectionHeader>

        {report && (
          <div className="flex gap-1 mb-3 border-b border-border">
            {[['cards', 'Report cards', FileText], ['remarks', 'Remarks', MessageSquareText]].map(([k, label, Icon]) => (
              <button key={k} onClick={() => setTab(k)}
                className={clsx('flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px',
                  tab === k ? 'border-blue text-blue' : 'border-transparent text-gray-400 hover:text-gray-600')}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>
        )}

        {!classId ? (
          <EmptyState icon={FileText} title="No class selected" description="Select a class to view its reports." />
        ) : loading ? <Spinner /> : !report ? null : report.cards.length === 0 ? (
          <EmptyState icon={FileText} title="No pupils in this class" description="Add pupils first." />
        ) : tab === 'cards' ? (
          <Table headers={['#', 'Pupil', 'Average', 'Position', 'Attendance', 'Remarks', '']}>
            {report.cards.map((c, i) => (
              <Tr key={c.student._id}>
                <Td className="text-gray-400">{i + 1}</Td>
                <Td className="font-medium">{c.student.fullName}</Td>
                <Td>
                  {c.subjectsScored ? <><span className="font-bold">{c.average.toFixed(1)}%</span><Badge variant={c.average >= 50 ? 'green' : 'red'} className="ml-2">{c.grade}</Badge></> : <span className="text-gray-300 text-xs">no marks</span>}
                </Td>
                <Td className="text-gray-500">{c.subjectsScored ? ordinal(c.position) : '—'}</Td>
                <Td className="text-gray-500 text-xs">{c.attendance.total ? `${c.attendance.present}/${c.attendance.total}` : '—'}</Td>
                <Td>{c.remarks.teacherRemark ? <Badge variant="green">✓</Badge> : <Badge variant="gray">—</Badge>}</Td>
                <Td><Button size="sm" onClick={() => setSelected(c.student._id)}><ChevronRight className="w-3.5 h-3.5" /> View</Button></Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <div>
            {!editable && <Alert variant="warn">These are last year's reports: remarks can only be written for the current academic year.</Alert>}
            <div className="flex flex-wrap gap-2 mb-3">
              <Button size="sm" onClick={suggestAll} disabled={!editable}><Sparkles className="w-3.5 h-3.5" /> Suggest remarks from marks</Button>
              <Button size="sm" variant="success" onClick={saveRemarks} disabled={!dirty || saving || !editable}><Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save remarks'}</Button>
            </div>
            {Object.entries(SUGGEST).map(([k, opts]) => (
              <datalist key={k} id={`sr-${k}`}>{opts.map((o) => <option key={o} value={o} />)}</datalist>
            ))}
            <div className="space-y-3">
              {report.cards.map((c) => {
                const r = remarks[c.student._id] || {}
                return (
                  <div key={c.student._id} className="border border-border rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-sm">{c.student.fullName}</span>
                      <span className="text-xs text-gray-400">{c.subjectsScored ? `${c.average.toFixed(1)}% · ${ordinal(c.position)}` : 'no marks yet'}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      {['conduct', 'attitude', 'interest'].map((f) => (
                        <Input key={f} list={`sr-${f}`} placeholder={f[0].toUpperCase() + f.slice(1)} value={r[f] || ''} maxLength={60}
                          disabled={!editable} onChange={(e) => setRemark(c.student._id, f, e.target.value)} aria-label={f} />
                      ))}
                      <Input placeholder="Promoted to (Term 3)" value={r.promotedTo || ''} maxLength={40} disabled={!editable}
                        onChange={(e) => setRemark(c.student._id, 'promotedTo', e.target.value)} aria-label="Promoted to" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                      <Input placeholder="Class teacher's remark" value={r.teacherRemark || ''} maxLength={300} disabled={!editable}
                        onChange={(e) => setRemark(c.student._id, 'teacherRemark', e.target.value)} aria-label="Class teacher's remark" />
                      <Input placeholder={canHeadRemark ? "Head teacher's remark" : "Head teacher's remark (written by the head)"} value={r.headRemark || ''} maxLength={300}
                        disabled={!canHeadRemark || !editable} onChange={(e) => setRemark(c.student._id, 'headRemark', e.target.value)} aria-label="Head teacher's remark" />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end mt-3">
              <Button variant="success" onClick={saveRemarks} disabled={!dirty || saving || !editable}><Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save remarks'}</Button>
            </div>
          </div>
        )}
      </Card>

      {card && (
        <div>
          <div className="flex justify-end gap-2 mb-3 no-print">
            <Button onClick={() => setSelected(null)}>← Back to list</Button>
            <Button variant="primary" onClick={() => window.print()}><Printer className="w-3.5 h-3.5" /> Print report</Button>
          </div>
          <ReportSheet report={report} card={card} logoUrl={logoUrl} />
        </div>
      )}
    </div>
  )
}
