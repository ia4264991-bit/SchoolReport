import { formatDate, ordinal } from '@/lib/format'

/**
 * The printable terminal report — for staff (one or a whole class), parents and pupils.
 * `report` is the API's class context ({ school, class, academicYear, term, subjects,
 * weights, gradingScale, classSize }) and `card` one pupil's card. Inline styles on
 * purpose: they print the same in every browser. Each sheet starts on a new page.
 */
const cell = { border: '1px solid #555', padding: '4px 6px' }
const line = { borderBottom: '0.5px solid #bbb', paddingBottom: '2px' }

export default function ReportSheet({ report, card, logoUrl }) {
  const { school, class: cls, academicYear, term, weights, gradingScale, classSize } = report
  const r = card.remarks
  const att = card.attendance
  return (
    <div className="report-sheet" style={{
      background: '#fff', color: '#111', border: '1px solid #ccc', borderRadius: '6px', padding: '22px',
      fontFamily: "'Times New Roman', Times, serif", fontSize: '12px', maxWidth: '820px', margin: '0 auto 16px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', borderBottom: '2.5px solid #222', paddingBottom: '8px', marginBottom: '10px', position: 'relative',
        minHeight: logoUrl ? '80px' : undefined, paddingLeft: logoUrl ? '86px' : undefined, paddingRight: logoUrl ? '86px' : undefined }}>
        {logoUrl && <img src={logoUrl} alt="School logo" style={{ position: 'absolute', left: 0, top: 0, width: '76px', height: '76px', objectFit: 'contain' }} />}
        <div style={{ fontSize: '10px', letterSpacing: '1.5px', color: '#444', marginBottom: '2px' }}>GHANA EDUCATION SERVICE</div>
        <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 2px' }}>{school.name}</h1>
        <div style={{ fontSize: '11px' }}>
          {[school.circuit && `${school.circuit} Circuit`, school.district && `${school.district} District`, school.region && `${school.region} Region`].filter(Boolean).join(' — ')}
        </div>
        <div style={{ fontSize: '13px', fontWeight: 'bold', marginTop: '5px' }}>PUPIL'S TERMINAL REPORT — TERM {term}, {academicYear}</div>
      </div>

      {/* Pupil */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '3px 18px', marginBottom: '10px', fontSize: '11px' }}>
        <span style={line}>Name: <b>{card.student.fullName}</b></span>
        <span style={line}>Class: <b>{cls.name}</b></span>
        <span style={line}>Position in class: <b>{ordinal(card.position)}</b> out of {classSize}</span>
        <span style={line}>Number on roll: {classSize}</span>
        <span style={line}>Attendance: <b>{att.present}</b> out of {att.total} day{att.total === 1 ? '' : 's'}</span>
        <span style={line}>Next term begins: {school.nextTermDate ? formatDate(school.nextTermDate) : '—'}</span>
        {r.promotedTo && <span style={line}>Promoted to: <b>{r.promotedTo}</b></span>}
      </div>

      {/* Marks */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px', fontSize: '11px' }}>
        <thead>
          <tr>
            {['Subject', `Class score\n(${weights.classScore}%)`, `Exam score\n(${weights.exam}%)`, 'Total\n(100%)', 'Position', 'Grade', 'Remark'].map((h) => (
              <th key={h} style={{ ...cell, background: '#e8e8e8', fontWeight: 'bold', textAlign: 'center', whiteSpace: 'pre' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {card.rows.map((row) => (
            <tr key={row.subjectId}>
              <td style={{ ...cell, fontWeight: 500 }}>{row.subject}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{row.hasScore ? row.classScoreWeighted.toFixed(1) : '—'}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{row.hasScore ? row.examScoreWeighted.toFixed(1) : '—'}</td>
              <td style={{ ...cell, textAlign: 'center', fontWeight: 'bold' }}>{row.hasScore ? row.total.toFixed(1) : '—'}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{row.hasScore ? ordinal(row.position) : '—'}</td>
              <td style={{ ...cell, textAlign: 'center', fontWeight: 'bold' }}>{row.hasScore ? row.grade : '—'}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{row.hasScore ? row.remark : ''}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...cell, fontWeight: 'bold' }}>Total / Average</td>
            <td style={cell} /><td style={cell} />
            <td style={{ ...cell, textAlign: 'center', fontWeight: 'bold' }}>{card.totalMark.toFixed(1)}</td>
            <td style={{ ...cell, textAlign: 'center', fontWeight: 'bold' }}>{ordinal(card.position)}</td>
            <td style={{ ...cell, textAlign: 'center', fontWeight: 'bold' }}>{card.grade}</td>
            <td style={{ ...cell, textAlign: 'center' }}>Average {card.average.toFixed(1)}%</td>
          </tr>
        </tbody>
      </table>

      {/* Conduct and remarks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px 14px', fontSize: '11px', marginBottom: '8px' }}>
        <span style={line}>Conduct: {r.conduct || ''}</span>
        <span style={line}>Attitude: {r.attitude || ''}</span>
        <span style={line}>Interest: {r.interest || ''}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '8px' }}>
        {[["Class teacher's remarks", r.teacherRemark], ["Head teacher's remarks", r.headRemark]].map(([label, text]) => (
          <div key={label} style={{ border: '1px solid #555', padding: '6px 8px', minHeight: '48px' }}>
            <div style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '3px' }}>{label}:</div>
            <div style={{ fontSize: '11px' }}>{text}</div>
          </div>
        ))}
      </div>

      {/* Signatures */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '18px', marginTop: '18px', fontSize: '10px' }}>
        {["Class teacher's signature", `Head teacher${school.headTeacher ? ` (${school.headTeacher})` : ''}`, "Parent / guardian's signature"].map((l) => (
          <div key={l} style={{ borderTop: '1px solid #333', paddingTop: '3px', textAlign: 'center' }}>{l}</div>
        ))}
      </div>

      {/* Grading key */}
      <div style={{ marginTop: '10px', borderTop: '1px solid #bbb', paddingTop: '5px', fontSize: '9px', color: '#444' }}>
        <b>Grading:</b>{' '}
        {gradingScale.map((b, i) => {
          const top = i === 0 ? 100 : gradingScale[i - 1].min - 0.1
          return `${b.grade} ${b.min}–${Number.isInteger(top) ? top : top.toFixed(1)}${b.remark ? ` (${b.remark})` : ''}`
        }).join(' · ')}
      </div>
    </div>
  )
}
