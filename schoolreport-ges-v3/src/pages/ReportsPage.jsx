import { useEffect, useMemo, useRef, useState } from 'react'
import { useSchoolStore } from '@/store/schoolStore'
import { useAuthStore } from '@/store/authStore'
import api, { errorMessage } from '@/lib/api'
import { gradeInfo, ordinal, buildRows, summarize } from '@/lib/grading'
import ReportSheet from '@/components/report/ReportSheet'
import { Card, SectionHeader, Button, Select, Table, Tr, Td, Badge, Spinner, EmptyState } from '@/components/ui'
import { FileText, Printer, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ReportsPage() {
  const { user } = useAuthStore()
  const { classes, subjects, fetchClasses, fetchSubjects, settings, logoUrl } = useSchoolStore()
  const isTeacher = user?.role === 'teacher'
  const [pickedClass, setPickedClass] = useState('')
  const selectedClass = isTeacher ? (user?.classId || '') : pickedClass
  const [term, setTerm] = useState(settings?.term || '1')
  const termTouched = useRef(false)
  const [students, setStudents] = useState([])
  const [allScores, setAllScores] = useState([])
  const [maxMarks, setMaxMarks] = useState({})
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchClasses(); fetchSubjects() }, [])

  // Start on the school's current term once settings arrive (unless the user already picked one).
  useEffect(() => {
    if (settings?.term && !termTouched.current) setTerm(settings.term)
  }, [settings?.term])

  useEffect(() => {
    if (!selectedClass) return
    setLoading(true)
    setSelectedStudent(null)
    Promise.all([
      api.get('/students', { params: { classId: selectedClass } }),
      api.get(`/scores/${selectedClass}/${term}`),
      api.get('/school/max-marks'),
    ]).then(([sRes, scRes, mRes]) => {
      setStudents(sRes.data)
      setAllScores(scRes.data)
      setMaxMarks(mRes.data)
    }).catch((err) => toast.error(errorMessage(err, 'Failed to load data')))
      .finally(() => setLoading(false))
  }, [selectedClass, term])

  // Every student's subject rows, average and position — computed once per data change
  // instead of once per table cell.
  const reports = useMemo(() => {
    const byKey = new Map(allScores.map(s => [`${s.studentId}|${s.subjectId}`, s]))
    const list = students.map(student => {
      const rows = buildRows(subjects, (subjectId) => byKey.get(`${student._id}|${subjectId}`), (subjectId) => maxMarks[subjectId])
      const { totalMark, avg } = summarize(rows)
      return { student, rows, totalMark, avg }
    })
    // Standard competition ranking: equal averages share a position (1st, 2nd, 2nd, 4th).
    const rounded = (r) => Math.round(r.avg * 10)
    const sorted = [...list].sort((a, b) => b.avg - a.avg)
    sorted.forEach((r, i) => {
      r.position = i > 0 && rounded(r) === rounded(sorted[i - 1]) ? sorted[i - 1].position : i + 1
    })
    return new Map(list.map(r => [r.student._id, r]))
  }, [students, subjects, allScores, maxMarks])

  const changeTerm = (t) => { termTouched.current = true; setTerm(t) }
  const printReport = () => window.print()

  const report = selectedStudent ? reports.get(selectedStudent._id) : null
  const reportRows = report?.rows || []
  const totalMark = report?.totalMark || 0
  const avgMark = report?.avg || 0
  const position = report ? ordinal(report.position) : '—'

  if (isTeacher && !user?.classId) {
    return (
      <Card>
        <EmptyState icon={FileText} title="No class assigned" description="Ask your school admin to assign you a class." />
      </Card>
    )
  }

  return (
    <div>
      <div className="mb-5 no-print">
        <h1 className="text-xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-400">Generate and print student report sheets</p>
      </div>

      {/* Controls — hidden when printing, so only the report sheet prints */}
      <Card className="no-print">
        <SectionHeader title={settings?.academicYear ? `Select Class & Term · ${settings.academicYear}` : 'Select Class & Term'}>
          <div className="flex gap-2">
            {!isTeacher && (
              <Select className="w-44" value={selectedClass} onChange={e => setPickedClass(e.target.value)}>
                <option value="">Select class…</option>
                {classes.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </Select>
            )}
            <Select className="w-32" value={term} onChange={e => changeTerm(e.target.value)}>
              <option value="1">Term 1</option>
              <option value="2">Term 2</option>
              <option value="3">Term 3</option>
            </Select>
          </div>
        </SectionHeader>

        {!selectedClass ? (
          <EmptyState icon={FileText} title="No class selected" description="Select a class to view student reports." />
        ) : loading ? <Spinner /> : students.length === 0 ? (
          <EmptyState icon={FileText} title="No students in this class" description="Add students first." />
        ) : (
          <Table headers={['#', 'Student', 'Avg %', 'Position', 'Action']}>
            {students.map((s, i) => {
              const r = reports.get(s._id)
              const { grade } = gradeInfo(r.avg)
              return (
                <Tr key={s._id}>
                  <Td className="text-gray-400">{i + 1}</Td>
                  <Td className="font-medium">{s.fullName}</Td>
                  <Td>
                    <span className="font-bold">{r.avg.toFixed(1)}%</span>
                    <Badge variant={r.avg >= 50 ? 'green' : 'red'} className="ml-2">{grade}</Badge>
                  </Td>
                  <Td className="text-gray-500">{ordinal(r.position)}</Td>
                  <Td>
                    <Button size="sm" onClick={() => setSelectedStudent(s)}>
                      <ChevronRight className="w-3.5 h-3.5" /> View Report
                    </Button>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      {/* Report Sheet */}
      {selectedStudent && (
        <div>
          <div className="flex justify-end gap-2 mb-3 no-print">
            <Button onClick={() => setSelectedStudent(null)}>← Back to List</Button>
            <Button variant="primary" onClick={printReport}>
              <Printer className="w-3.5 h-3.5" /> Print Report
            </Button>
          </div>

          <ReportSheet
            settings={settings}
            logoUrl={logoUrl}
            studentName={selectedStudent.fullName}
            className={classes.find(c => c._id === selectedClass)?.name}
            academicYear={settings?.academicYear}
            term={term}
            rows={reportRows}
            totalMark={totalMark}
            avgMark={avgMark}
            position={position}
            classSize={students.length}
          />
        </div>
      )}
    </div>
  )
}
