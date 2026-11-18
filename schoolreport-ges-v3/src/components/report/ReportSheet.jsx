import { formatDate } from '@/lib/format'
import { gradeInfo } from '@/lib/grading'

/**
 * The printable GES terminal report sheet — used by staff (Reports) and by students
 * (My Report). Inline styles on purpose: they print the same in every browser.
 */
export default function ReportSheet({
  settings, logoUrl, studentName, className, academicYear, term,
  rows, totalMark, avgMark, position, classSize,
}) {
  const overall = gradeInfo(avgMark)
  return (
    <div className="report-sheet" style={{
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
          [`Student's Name: ${studentName}`, `Class: ${className || ''}`],
          [`Academic Year: ${academicYear || ''}`, `Term: Term ${term}`],
          [`Position: ${position} out of ${classSize}`, `Total Students: ${classSize}`],
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
          [overall.grade, 'Grade'],
          [overall.remark, 'Remark'],
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
          {rows.map(r => (
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
  )
}
