import { formatDate, ordinal, cedis } from '@/lib/format'

/*
 * End-of-term printouts. Inline styles so they print the same everywhere; the wide ones
 * use a landscape page (see .print-landscape in globals.css).
 */
const cell = { border: '1px solid #666', padding: '3px 5px' }
const head = { ...cell, background: '#e8e8e8', fontWeight: 'bold', textAlign: 'center' }

function SheetHeader({ school, title, sub, logoUrl }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '2px solid #222', paddingBottom: '6px', marginBottom: '8px' }}>
      {logoUrl && <img src={logoUrl} alt="" style={{ width: '54px', height: '54px', objectFit: 'contain' }} />}
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{school}</div>
        <div style={{ fontSize: '13px', fontWeight: 'bold' }}>{title}</div>
        {sub && <div style={{ fontSize: '11px' }}>{sub}</div>}
      </div>
      {logoUrl && <div style={{ width: '54px' }} />}
    </div>
  )
}

const sheet = (landscape) => ({
  background: '#fff', color: '#111', fontFamily: "'Times New Roman', Times, serif", fontSize: '11px',
  padding: '16px', border: '1px solid #ccc', borderRadius: '6px', marginBottom: '16px', overflowX: 'auto',
  maxWidth: landscape ? '100%' : '820px', marginLeft: 'auto', marginRight: 'auto',
})

/** Class broadsheet: every pupil × subject total, overall total, average and position. */
export function Broadsheet({ report, logoUrl }) {
  const ranked = [...report.cards].sort((a, b) => a.position - b.position || a.student.fullName.localeCompare(b.student.fullName))
  return (
    <div className="print-sheet print-landscape" style={sheet(true)}>
      <SheetHeader school={report.school.name} logoUrl={logoUrl} title={`BROADSHEET — ${report.class.name}`}
        sub={`Term ${report.term}, ${report.academicYear} · ${report.classSize} pupils · subject totals out of 100`} />
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '10px' }}>
        <thead>
          <tr>
            <th style={head}>#</th>
            <th style={{ ...head, textAlign: 'left' }}>Pupil</th>
            {report.subjects.map((s) => <th key={s._id} style={{ ...head, writingMode: report.subjects.length > 8 ? 'vertical-rl' : undefined }}>{s.code || s.name}</th>)}
            <th style={head}>Total</th><th style={head}>Average</th><th style={head}>Grade</th><th style={head}>Pos.</th><th style={head}>Att.</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((c, i) => (
            <tr key={c.student._id}>
              <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
              <td style={{ ...cell, whiteSpace: 'nowrap' }}>{c.student.fullName}</td>
              {c.rows.map((r) => <td key={r.subjectId} style={{ ...cell, textAlign: 'center' }}>{r.hasScore ? r.total.toFixed(0) : '—'}</td>)}
              <td style={{ ...cell, textAlign: 'center', fontWeight: 'bold' }}>{c.totalMark.toFixed(1)}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{c.average.toFixed(1)}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{c.grade}</td>
              <td style={{ ...cell, textAlign: 'center', fontWeight: 'bold' }}>{ordinal(c.position)}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{c.attendance.total ? `${c.attendance.present}/${c.attendance.total}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: '6px', fontSize: '9px' }}>
        Subjects: {report.subjects.map((s) => `${s.code || s.name}${s.code ? ` = ${s.name}` : ''}`).join(' · ')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '26px', fontSize: '10px' }}>
        <span style={{ borderTop: '1px solid #333', paddingTop: '2px', width: '30%', textAlign: 'center' }}>Class teacher</span>
        <span style={{ borderTop: '1px solid #333', paddingTop: '2px', width: '30%', textAlign: 'center' }}>Head teacher</span>
      </div>
    </div>
  )
}

/** The term's attendance register, laid out like the paper book: names down, days across. */
export function RegisterSheet({ register, schoolName, logoUrl }) {
  const { days, students } = register
  const total = days.length
  return (
    <div className="print-sheet print-landscape" style={sheet(true)}>
      <SheetHeader school={schoolName} logoUrl={logoUrl} title={`ATTENDANCE REGISTER — ${register.class.name}`}
        sub={`Term ${register.term}, ${register.academicYear} · register taken on ${total} day${total === 1 ? '' : 's'}`} />
      {total === 0 ? <p>No register has been taken this term.</p> : (
        <table style={{ borderCollapse: 'collapse', fontSize: '9px' }}>
          <thead>
            <tr>
              <th style={head}>#</th>
              <th style={{ ...head, textAlign: 'left' }}>Pupil</th>
              {days.map((d) => (
                <th key={d} style={{ ...head, padding: '2px', minWidth: '16px' }}>
                  {new Date(`${d}T00:00:00`).getDate()}<br />
                  <span style={{ fontWeight: 'normal' }}>{new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { month: 'short' })}</span>
                </th>
              ))}
              <th style={head}>Present</th><th style={head}>Absent</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s, i) => (
              <tr key={s._id}>
                <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{s.fullName}{!s.current && <span style={{ color: '#888' }}> (left)</span>}</td>
                {days.map((d) => {
                  const m = s.marks[d]
                  return <td key={d} style={{ ...cell, padding: '2px', textAlign: 'center', fontWeight: m === 'A' ? 'bold' : 'normal', color: m === 'A' ? '#b00' : '#111' }}>{m === 'P' ? '✓' : m === 'A' ? 'O' : ''}</td>
                })}
                <td style={{ ...cell, textAlign: 'center', fontWeight: 'bold' }}>{s.present}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{s.absent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ marginTop: '6px', fontSize: '9px' }}>✓ present · O absent · blank: not on the register that day</div>
    </div>
  )
}

/** "Who owes" list for a class, for the bursar's file. */
export function FeesListSheet({ list, schoolName, logoUrl }) {
  return (
    <div className="print-sheet" style={sheet(false)}>
      <SheetHeader school={schoolName} logoUrl={logoUrl} title={`SCHOOL FEES — ${list.class.name}`} sub={`Term ${list.term}, ${list.academicYear} · printed ${formatDate(new Date().toISOString())}`} />
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>{['#', 'Pupil', 'Billed this term', 'Paid this term', 'Balance owed'].map((h) => <th key={h} style={head}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {list.pupils.map((p, i) => (
            <tr key={p._id}>
              <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
              <td style={cell}>{p.fullName}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{cedis(p.termCharged)}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{cedis(p.termPaid)}</td>
              <td style={{ ...cell, textAlign: 'right', fontWeight: 'bold' }}>{p.balance > 0 ? cedis(p.balance) : 'Paid'}</td>
            </tr>
          ))}
          <tr>
            <td style={cell} /><td style={{ ...cell, fontWeight: 'bold' }}>Total</td>
            <td style={{ ...cell, textAlign: 'right', fontWeight: 'bold' }}>{cedis(list.totals.termCharged)}</td>
            <td style={{ ...cell, textAlign: 'right', fontWeight: 'bold' }}>{cedis(list.totals.termPaid)}</td>
            <td style={{ ...cell, textAlign: 'right', fontWeight: 'bold' }}>{cedis(list.totals.owed)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** A payment receipt (half an A4 page). */
export function Receipt({ payment, schoolName, logoUrl }) {
  const methods = { cash: 'Cash', momo: 'Mobile Money', bank: 'Bank', cheque: 'Cheque', online: 'Online (Paystack)' }
  return (
    <div className="print-sheet" style={{ ...sheet(false), maxWidth: '560px' }}>
      <SheetHeader school={schoolName} logoUrl={logoUrl} title="OFFICIAL RECEIPT" sub={`No. ${payment.receiptNo}`} />
      {payment.voided && <div style={{ border: '2px solid #b00', color: '#b00', fontWeight: 'bold', textAlign: 'center', padding: '4px', marginBottom: '8px' }}>VOID — {payment.voidReason}</div>}
      <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
        <tbody>
          {[
            ['Date', formatDate(payment.paidOn)],
            ['Received from', payment.guardianName ? `${payment.guardianName} (for ${payment.pupil})` : payment.pupil],
            ['Pupil / class', `${payment.pupil}${payment.className ? ` — ${payment.className}` : ''}`],
            ['Amount', cedis(payment.amount)],
            ['Paid by', `${methods[payment.method] || payment.method}${payment.reference ? ` · ref ${payment.reference}` : ''}`],
            ['For', `School fees, Term ${payment.term} ${payment.academicYear}${payment.note ? ` — ${payment.note}` : ''}`],
            ['Balance remaining', payment.balance > 0 ? cedis(payment.balance) : 'Nothing owed'],
            ['Received by', payment.receivedBy],
          ].map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: '4px 0', color: '#555', width: '38%' }}>{k}</td>
              <td style={{ padding: '4px 0', fontWeight: k === 'Amount' ? 'bold' : 'normal', fontSize: k === 'Amount' ? '15px' : undefined }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: '26px', display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ borderTop: '1px solid #333', paddingTop: '2px', width: '45%', textAlign: 'center', fontSize: '10px' }}>Signature / stamp</span>
      </div>
    </div>
  )
}
