import { useEffect, useMemo, useRef, useState } from 'react'
import { useSchoolStore } from '@/store/schoolStore'
import { useAuthStore } from '@/store/authStore'
import api, { errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { Card, SectionHeader, Button, Select, Table, Tr, Td, Badge, Spinner, EmptyState } from '@/components/ui'
import { FileText, Printer, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'

const GRADES = [
  { min: 80, grade: 'A1', remark: 'Excellent' },
  { min: 70, grade: 'B2', remark: 'Very Good' },
  { min: 60, grade: 'B3', remark: 'Good' },
  { min: 55, grade: 'C4', remark: 'Credit' },
  { min: 50, grade: 'C5', remark: 'Credit' },
  { min: 45, grade: 'C6', remark: 'Credit' },
  { min: 40, grade: 'D7', remark: 'Pass' },
  { min: 35, grade: 'E8', remark: 'Pass' },
  { min: 0,  grade: 'F9', remark: 'Fail' },
]

function gradeInfo(total) {
  for (const g of GRADES) {
    if (parseFloat(total) >= g.min) return g
  }
  return { grade: '—', remark: '—' }
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd", 113 → "113th" */
function ordinal(n) {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}

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
  const printRef = useRef()

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
      const rows = subjects.map(sub => {
        const entry = byKey.get(`${student._id}|${sub._id}`)
        const max = maxMarks[sub._id] || 100
        const cs = parseFloat(entry?.classScore || 0)
        const es = parseFloat(entry?.examScore || 0)
        const csConverted = (cs / max) * 40
        const esConverted = (es / 100) * 60
        const total = csConverted + esConverted
        const { grade, remark } = gradeInfo(total)
        return { subject: sub.name, cs, es, csConverted, esConverted, total, grade, remark }
      })
      const totalMark = rows.reduce((a, r) => a + r.total, 0)
      const avg = rows.length ? totalMark / rows.length : 0
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

          <div ref={printRef} className="report-sheet" style={{
            background: '#fff', color: '#111', border: '1px solid #ccc',
            borderRadius: '6px', padding: '24px',
            fontFamily: "'Times New Roman', Times, serif",
            fontSize: '12px', maxWidth: '820px', margin: '0 auto',
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)'
          }}>
            {/* Header */}
            <div style={{ textAlign: 'center', borderBottom: '2.5px solid #222', paddingBottom: '10px', marginBottom: '14px', position: 'relative', minHeight: logoUrl ? '84px' : undefined,
              // keep a long school name clear of the logo
              paddingLeft: logoUrl ? '88px' : undefined, paddingRight: logoUrl ? '88px' : undefined }}>
              {logoUrl && (
                <img src={logoUrl} alt="School logo"
                  style={{ position: 'absolute', left: 0, top: 0, width: '80px', height: '80px', objectFit: 'contain' }} />
              )}
              <div style={{ fontSize: '10px', letterSpacing: '1.5px', color: '#444', marginBottom: '3px' }}>GHANA EDUCATION SERVICE</div>
              <h1 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '2px' }}>
                {settings?.schoolName || 'SCHOOL NAME'}
              </h1>
              <div style={{ fontSize: '12px' }}>
                {[
                  settings?.circuit && `${settings.circuit} Circuit`,
                  settings?.district && `${settings.district} District`,
                  settings?.region && `${settings.region} Region`,
                ].filter(Boolean).join(' — ')}
              </div>
              <div style={{ fontSize: '13px', fontWeight: 'bold', marginTop: '6px' }}>STUDENT TERMINAL REPORT — TERM {term}</div>
            </div>

            {/* Meta */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px', marginBottom: '12px', fontSize: '11px' }}>
              {[
                [`Student's Name: ${selectedStudent.fullName}`, `Class: ${classes.find(c => c._id === selectedClass)?.name || ''}`],
                [`Academic Year: ${settings?.academicYear || ''}`, `Term: Term ${term}`],
                [`Position: ${position} out of ${students.length}`, `Total Students: ${students.length}`],
                [
                  `Next Term Begins: ${settings?.nextTermDate ? formatDate(settings.nextTermDate) : '—'}`,
                  `Head Teacher: ${settings?.headTeacher || ''}`,
                ],
              ].flat().map((t, i) => (
                <span key={i} style={{ borderBottom: '0.5px solid #bbb', paddingBottom: '2px' }}>{t}</span>
              ))}
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '8px', marginBottom: '12px' }}>
              {[
                [totalMark.toFixed(1), 'Total Marks'],
                [avgMark.toFixed(1) + '%', 'Average'],
                [position, 'Position'],
                [gradeInfo(avgMark).grade, 'Grade'],
                [gradeInfo(avgMark).remark, 'Remark'],
              ].map(([val, lbl]) => (
                <div key={lbl} style={{ border: '1.5px solid #444', padding: '6px', textAlign: 'center', borderRadius: '3px' }}>
                  <div style={{ fontSize: '15px', fontWeight: 'bold' }}>{val}</div>
                  <div style={{ fontSize: '9px', color: '#555' }}>{lbl}</div>
                </div>
              ))}
            </div>

            {/* Scores Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '12px', fontSize: '11px' }}>
              <thead>
                <tr>
                  {['Subject', 'Class Score\n(40%)', 'Exam Score\n(60%)', 'Total\n(100%)', 'Grade', 'Remark'].map(h => (
                    <th key={h} style={{ border: '1px solid #555', padding: '5px 7px', background: '#e8e8e8', fontWeight: 'bold', textAlign: 'center', whiteSpace: 'pre' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reportRows.map(r => (
                  <tr key={r.subject}>
                    <td style={{ border: '1px solid #555', padding: '5px 7px', fontWeight: '500' }}>{r.subject}</td>
                    <td style={{ border: '1px solid #555', padding: '5px 7px', textAlign: 'center' }}>{r.csConverted.toFixed(1)}</td>
                    <td style={{ border: '1px solid #555', padding: '5px 7px', textAlign: 'center' }}>{r.esConverted.toFixed(1)}</td>
                    <td style={{ border: '1px solid #555', padding: '5px 7px', textAlign: 'center', fontWeight: 'bold' }}>{r.total.toFixed(1)}</td>
                    <td style={{ border: '1px solid #555', padding: '5px 7px', textAlign: 'center', fontWeight: 'bold' }}>{r.grade}</td>
                    <td style={{ border: '1px solid #555', padding: '5px 7px', textAlign: 'center' }}>{r.remark}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Remarks */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
              {["Class Teacher's Remarks", "Head Teacher's Remarks"].map(lbl => (
                <div key={lbl} style={{ border: '1px solid #555', padding: '8px', minHeight: '55px' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '10px', display: 'block', marginBottom: '4px' }}>{lbl}:</label>
                  <div style={{ borderBottom: '1px dashed #aaa', marginTop: '20px' }}></div>
                </div>
              ))}
            </div>

            {/* Signatures */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginTop: '10px', fontSize: '10px' }}>
              {["Class Teacher's Signature", "Head Teacher's Signature", "Parent/Guardian's Signature"].map(lbl => (
                <div key={lbl} style={{ borderTop: '1px solid #333', paddingTop: '3px', textAlign: 'center' }}>{lbl}</div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ marginTop: '10px', borderTop: '1px solid #bbb', paddingTop: '6px', fontSize: '9px', textAlign: 'center', color: '#555' }}>
              Generated by SchoolReport GES — Ghana Education Service Automated Report System
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
