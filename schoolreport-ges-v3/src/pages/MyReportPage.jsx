import { useEffect, useRef, useState } from 'react'
import { useSchoolStore } from '@/store/schoolStore'
import api, { errorMessage } from '@/lib/api'
import ReportSheet from '@/components/report/ReportSheet'
import { Card, SectionHeader, Button, Select, Spinner, EmptyState, PageHeader } from '@/components/ui'
import { FileText, Printer } from 'lucide-react'

/**
 * A pupil's own terminal report (student logins), or one child's (parents pass studentId).
 * The API returns only this pupil's card — never classmates' marks.
 */
export function ChildReport({ studentId }) {
  const { settings, logoUrl } = useSchoolStore()
  const [term, setTerm] = useState(settings?.term || '1')
  const termTouched = useRef(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (settings?.term && !termTouched.current) setTerm(settings.term) }, [settings?.term])

  useEffect(() => {
    setLoading(true)
    setError('')
    api.get('/reports/me', { params: { term, ...(studentId ? { studentId } : {}) } })
      .then((r) => setData(r.data))
      .catch((err) => { setData(null); setError(errorMessage(err, 'Could not load the report.')) })
      .finally(() => setLoading(false))
  }, [term, studentId])

  const hasMarks = data?.card?.subjectsScored > 0
  return (
    <div>
      <div className="no-print">
        <Card>
          <SectionHeader title={data ? `${data.card.student.fullName} · ${data.class.name} · ${data.academicYear}` : 'Report'}>
            <Select className="w-28" value={term} onChange={(e) => { termTouched.current = true; setTerm(e.target.value) }} aria-label="Term">
              <option value="1">Term 1</option><option value="2">Term 2</option><option value="3">Term 3</option>
            </Select>
            {hasMarks && <Button variant="primary" onClick={() => window.print()}><Printer className="w-3.5 h-3.5" /> Print</Button>}
          </SectionHeader>
          {loading ? <Spinner /> : error ? (
            <EmptyState icon={FileText} title="Report not available" description={error} />
          ) : data && !hasMarks ? (
            <EmptyState icon={FileText} title="No marks yet for this term"
              description="The teachers have not entered marks for this term yet. Check back later or choose another term." />
          ) : null}
        </Card>
      </div>
      {!loading && hasMarks && <ReportSheet report={data} card={data.card} logoUrl={logoUrl} />}
    </div>
  )
}

export default function MyReportPage() {
  return (
    <div>
      <div className="no-print"><PageHeader title="My Report" subtitle="Your terminal report — print it or save it as PDF" /></div>
      <ChildReport />
    </div>
  )
}
