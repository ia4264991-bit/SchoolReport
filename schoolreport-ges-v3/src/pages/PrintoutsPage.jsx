import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { useSchoolStore } from '@/store/schoolStore'
import api, { errorMessage } from '@/lib/api'
import ReportSheet from '@/components/report/ReportSheet'
import { Broadsheet, RegisterSheet, FeesListSheet } from '@/components/report/PrintSheets'
import { Card, SectionHeader, Button, Select, Spinner, EmptyState, Alert, PageHeader } from '@/components/ui'
import { Printer, FileStack } from 'lucide-react'

/**
 * End-of-term printing: every pupil's report, the broadsheet, the attendance register and
 * the fees list — for one class or the whole school. Preview on screen, then Print (or
 * "Save as PDF" in the print window).
 */
export default function PrintoutsPage() {
  const { user } = useAuthStore()
  const { classes, fetchClasses, settings, logoUrl } = useSchoolStore()
  const [params, setParams] = useSearchParams()
  const role = user?.role
  const isTeacher = role === 'teacher'
  const options = [
    ['reports', 'All report cards', ['admin', 'head', 'teacher']],
    ['broadsheet', 'Broadsheet (class results)', ['admin', 'head', 'teacher']],
    ['register', 'Attendance register', ['admin', 'head', 'teacher']],
    ['fees', 'School fees list', ['admin', 'head', 'bursar']],
  ].filter(([, , roles]) => roles.includes(role))
  const what = options.some(([k]) => k === params.get('what')) ? params.get('what') : options[0]?.[0]
  const classId = isTeacher ? (user?.classId || '') : (params.get('classId') || '')
  const term = params.get('term') || settings?.term || '1'
  const set = (k, v) => setParams((p) => { const n = new URLSearchParams(p); n.set(k, v); return n }, { replace: true })

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchClasses() }, [])

  useEffect(() => {
    if (!classId || !what) { setItems([]); return }
    const ids = classId === 'all' ? classes.map((c) => c._id) : [classId]
    if (!ids.length) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const out = []
      for (const id of ids) {
        const url = {
          reports: `/reports/cards/${id}/${term}`,
          broadsheet: `/reports/cards/${id}/${term}`,
          register: `/attendance/${id}/register?term=${term}`,
          fees: `/fees/classes/${id}?term=${term}`,
        }[what]
        try { out.push((await api.get(url)).data) } catch (err) { toast.error(errorMessage(err, 'Could not load a class')) }
      }
      if (!cancelled) setItems(out)
    })().finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [what, classId, term, classes.length])

  const pages = what === 'reports' ? items.reduce((a, r) => a + r.cards.length, 0) : items.length
  const schoolName = settings?.schoolName || ''

  return (
    <div>
      <div className="no-print">
        <PageHeader title="End of term printouts" subtitle="Print or save as PDF for the school's files" />
        <Card>
          <SectionHeader title="What to print">
            <Select className="w-52" value={what} onChange={(e) => set('what', e.target.value)} aria-label="What to print">
              {options.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
            {!isTeacher && (
              <Select className="w-40" value={classId} onChange={(e) => set('classId', e.target.value)} aria-label="Class">
                <option value="">Select class…</option>
                <option value="all">All classes</option>
                {classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </Select>
            )}
            <Select className="w-28" value={term} onChange={(e) => set('term', e.target.value)} aria-label="Term">
              <option value="1">Term 1</option><option value="2">Term 2</option><option value="3">Term 3</option>
            </Select>
            <Button variant="primary" onClick={() => window.print()} disabled={!items.length || loading}>
              <Printer className="w-3.5 h-3.5" /> Print {pages ? `(${pages} page${pages === 1 ? '' : 's'})` : ''}
            </Button>
          </SectionHeader>
          {what === 'reports' && <Alert variant="info">Each report prints on its own page. In the print window choose your printer, or "Save as PDF" to keep a copy.</Alert>}
          {(what === 'broadsheet' || what === 'register') && <Alert variant="info">These print on landscape pages.</Alert>}
          {!classId && <EmptyState icon={FileStack} title="Choose a class" description="Or choose All classes to print the whole school at once." />}
        </Card>
      </div>

      {loading ? <Spinner /> : (
        <div>
          {what === 'reports' && items.map((r) => r.cards.map((c) => <ReportSheet key={c.student._id} report={r} card={c} logoUrl={logoUrl} />))}
          {what === 'broadsheet' && items.map((r) => <Broadsheet key={r.class._id} report={r} logoUrl={logoUrl} />)}
          {what === 'register' && items.map((r) => <RegisterSheet key={r.class._id} register={r} schoolName={schoolName} logoUrl={logoUrl} />)}
          {what === 'fees' && items.map((l) => <FeesListSheet key={l.class._id} list={l} schoolName={schoolName} logoUrl={logoUrl} />)}
        </div>
      )}
    </div>
  )
}
