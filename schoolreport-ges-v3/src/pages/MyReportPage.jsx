import { useEffect, useMemo, useRef, useState } from 'react'
import { useSchoolStore } from '@/store/schoolStore'
import api, { errorMessage } from '@/lib/api'
import { ordinal, buildRows, summarize } from '@/lib/grading'
import ReportSheet from '@/components/report/ReportSheet'
import { Card, SectionHeader, Button, Select, Spinner, EmptyState, PageHeader } from '@/components/ui'
import { FileText, Printer } from 'lucide-react'

/**
 * A student login's own report (also what a parent sees when signed in with it).
 * The API returns only this student's marks plus their position — never classmates' data.
 */
export default function MyReportPage() {
  const { settings, logoUrl } = useSchoolStore()
  const [term, setTerm] = useState(settings?.term || '1')
  const termTouched = useRef(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // Start on the school's current term once settings arrive (unless already changed).
  useEffect(() => {
    if (settings?.term && !termTouched.current) setTerm(settings.term)
  }, [settings?.term])

  useEffect(() => {
    setLoading(true)
    setError('')
    api.get('/reports/me', { params: { term } })
      .then((r) => setData(r.data))
      .catch((err) => { setData(null); setError(errorMessage(err, 'Could not load your report.')) })
      .finally(() => setLoading(false))
  }, [term])

  const report = useMemo(() => {
    if (!data) return null
    const byId = new Map(data.scores.map((s) => [s.subjectId, s]))
    const maxById = new Map(data.subjects.map((s) => [s._id, s.maxClassScore]))
    const rows = buildRows(data.subjects, (id) => byId.get(id), (id) => maxById.get(id))
    return { rows, ...summarize(rows) }
  }, [data])

  const changeTerm = (t) => { termTouched.current = true; setTerm(t) }

  return (
    <div>
      <div className="no-print">
        <PageHeader title="My Report" subtitle="Your terminal report — print or save it as PDF" />
        <Card>
          <SectionHeader title={data ? `${data.student.fullName} · ${data.class.name} · ${data.academicYear}` : 'Term'}>
            <div className="flex gap-2">
              <Select className="w-32" value={term} onChange={(e) => changeTerm(e.target.value)} aria-label="Term">
                <option value="1">Term 1</option>
                <option value="2">Term 2</option>
                <option value="3">Term 3</option>
              </Select>
              {data && (
                <Button variant="primary" onClick={() => window.print()}>
                  <Printer className="w-3.5 h-3.5" /> Print
                </Button>
              )}
            </div>
          </SectionHeader>
          {loading ? <Spinner /> : error ? (
            <EmptyState icon={FileText} title="Report not available" description={error} />
          ) : data && data.scores.length === 0 ? (
            <EmptyState icon={FileText} title="No marks yet for this term"
              description="Your teachers have not entered any marks for this term yet. Check back later or choose another term." />
          ) : null}
        </Card>
      </div>

      {!loading && data && report && data.scores.length > 0 && (
        <ReportSheet
          settings={settings}
          logoUrl={logoUrl}
          studentName={data.student.fullName}
          className={data.class.name}
          academicYear={data.academicYear}
          term={data.term}
          rows={report.rows}
          totalMark={report.totalMark}
          avgMark={report.avg}
          position={ordinal(data.position)}
          classSize={data.classSize}
        />
      )}
    </div>
  )
}
