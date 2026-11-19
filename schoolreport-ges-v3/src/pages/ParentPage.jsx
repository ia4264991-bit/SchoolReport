import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import api, { errorMessage } from '@/lib/api'
import { cedis, formatDate, shortDate } from '@/lib/format'
import { ChildReport } from '@/pages/MyReportPage'
import { Card, SectionHeader, Button, Input, Spinner, EmptyState, Alert, Badge, Table, Tr, Td, PageHeader, Modal, Field } from '@/components/ui'
import { FileText, CalendarCheck, Wallet, Megaphone, Users } from 'lucide-react'

function Attendance({ studentId }) {
  const [d, setD] = useState(null)
  useEffect(() => {
    setD(null)
    api.get(`/parent/children/${studentId}/attendance`).then((r) => setD(r.data)).catch(() => setD({ error: true }))
  }, [studentId])
  if (!d) return <Spinner />
  if (d.error) return <EmptyState icon={CalendarCheck} title="Not available" />
  return (
    <Card>
      <SectionHeader title={`Attendance · Term ${d.term}, ${d.academicYear}`} />
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-xl bg-green-light p-3 text-center"><div className="text-2xl font-bold text-green">{d.present}</div><div className="text-[11px] text-green">Present</div></div>
        <div className="rounded-xl bg-red-light p-3 text-center"><div className="text-2xl font-bold text-red">{d.absent}</div><div className="text-[11px] text-red">Absent</div></div>
        <div className="rounded-xl bg-gray-100 p-3 text-center"><div className="text-2xl font-bold text-gray-600">{d.total}</div><div className="text-[11px] text-gray-500">School days</div></div>
      </div>
      {d.absentDays.length > 0
        ? <div className="text-sm text-gray-600">Absent on: {d.absentDays.map(shortDate).join(', ')}</div>
        : <div className="text-sm text-gray-500">{d.total ? 'Present every day so far. 👏' : 'The register has not been taken this term yet.'}</div>}
    </Card>
  )
}

function Fees({ studentId, onlinePayment }) {
  const [st, setSt] = useState(null)
  const [payOpen, setPayOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setSt(null)
    api.get(`/parent/children/${studentId}/fees`).then((r) => setSt(r.data)).catch(() => setSt({ error: true }))
  }, [studentId])

  const pay = async () => {
    setBusy(true)
    try {
      const { data } = await api.post(`/parent/children/${studentId}/fees/pay`, { amount })
      window.location.assign(data.authorizationUrl) // Paystack's page (MoMo or card), then back here
    } catch (err) {
      toast.error(errorMessage(err, 'Could not start the payment'))
      setBusy(false)
    }
  }

  if (!st) return <Spinner />
  if (st.error) return <EmptyState icon={Wallet} title="Not available" />
  return (
    <Card>
      <SectionHeader title="School fees">
        {onlinePayment && st.balance > 0 && (
          <Button variant="primary" onClick={() => { setAmount(String(st.balance)); setPayOpen(true) }}><Wallet className="w-3.5 h-3.5" /> Pay with MoMo or card</Button>
        )}
      </SectionHeader>
      <div className={clsx('rounded-xl p-4 mb-3 text-center', st.balance > 0 ? 'bg-amber-light' : 'bg-green-light')}>
        <div className={clsx('text-2xl font-bold', st.balance > 0 ? 'text-amber' : 'text-green')}>{st.balance > 0 ? cedis(st.balance) : 'All paid'}</div>
        <div className="text-xs text-gray-500 mt-1">{st.balance > 0 ? 'still to pay' : st.balance < 0 ? `${cedis(-st.balance)} paid in advance` : 'Thank you!'}</div>
      </div>
      {!onlinePayment && st.balance > 0 && <Alert variant="info">Please pay at the school office. You will get a receipt.</Alert>}
      <Table headers={['Date', 'Item', 'Amount']}>
        {st.charges.map((c) => (
          <Tr key={c._id}><Td className="text-xs text-gray-400">Term {c.term}</Td><Td>{c.description}</Td><Td className="text-right">{cedis(c.amount)}</Td></Tr>
        ))}
        {st.payments.map((p) => (
          <Tr key={p._id}><Td className="text-xs text-gray-400">{formatDate(p.paidOn)}</Td><Td>Payment · receipt {p.receiptNo}</Td><Td className="text-right text-green">−{cedis(p.amount)}</Td></Tr>
        ))}
      </Table>
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Pay school fees"
        footer={<><Button onClick={() => setPayOpen(false)}>Cancel</Button><Button variant="primary" onClick={pay} disabled={busy || !(Number(amount) >= 1)}>{busy ? 'Opening…' : `Pay ${cedis(amount)}`}</Button></>}>
        <Field label="Amount (GHS)"><Input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <p className="text-xs text-gray-500">You will choose Mobile Money (MTN, Telecel, AirtelTigo) or a card on the secure Paystack page. The money goes straight to the school, and the payment shows here with a receipt number.</p>
      </Modal>
    </Card>
  )
}

function Notices() {
  const [list, setList] = useState(null)
  useEffect(() => { api.get('/parent/notices').then((r) => setList(r.data)).catch(() => setList([])) }, [])
  if (!list) return <Spinner />
  if (!list.length) return <Card><EmptyState icon={Megaphone} title="No notices yet" /></Card>
  return list.map((n) => (
    <Card key={n._id}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-bold text-sm text-gray-900">{n.title}</div>
        <div className="text-[11px] text-gray-400 whitespace-nowrap">{shortDate(n.createdAt)}</div>
      </div>
      {n.className && <Badge variant="blue" className="mb-1">{n.className}</Badge>}
      <p className="text-sm text-gray-600 whitespace-pre-line">{n.body}</p>
    </Card>
  ))
}

export default function ParentPage() {
  const [params, setParams] = useSearchParams()
  const [kids, setKids] = useState(null)
  const [online, setOnline] = useState(false)
  const [childId, setChildId] = useState('')
  const [tab, setTab] = useState('report')

  useEffect(() => {
    api.get('/parent/children')
      .then((r) => { setKids(r.data.children); setOnline(r.data.onlinePayment); setChildId(r.data.children[0]?._id || '') })
      .catch((err) => { setKids([]); toast.error(errorMessage(err, 'Could not load your children')) })
  }, [])

  // Back from Paystack: ?reference=… — confirm the payment.
  useEffect(() => {
    const reference = params.get('reference') || params.get('trxref')
    if (!reference) return
    setParams({}, { replace: true })
    api.get(`/payments/paystack/verify/${encodeURIComponent(reference)}`)
      .then(({ data }) => {
        if (data.status === 'success') { toast.success(`Payment received — receipt ${data.receiptNo}. Thank you!`, { duration: 8000 }); setTab('fees') }
        else if (data.status === 'pending') toast('Your payment is still being confirmed. Check again in a few minutes.', { duration: 8000 })
        else toast.error('The payment did not go through. No money was taken for it here.')
      })
      .catch((err) => toast.error(errorMessage(err, 'Could not confirm the payment')))
  }, [])

  if (!kids) return <Spinner />
  if (!kids.length) {
    return <Card><EmptyState icon={Users} title="No pupils found" description="No pupil at this school has your phone number. Ask the school to add it to your child's record." /></Card>
  }
  const tabs = [['report', 'Report', FileText], ['attendance', 'Attendance', CalendarCheck], ['fees', 'Fees', Wallet], ['notices', 'Notices', Megaphone]]

  return (
    <div>
      <div className="no-print">
        <PageHeader title="My children" subtitle="Reports, attendance, fees and school notices" />
        {kids.length > 1 && (
          <div className="flex gap-2 mb-3 overflow-x-auto">
            {kids.map((k) => (
              <button key={k._id} onClick={() => setChildId(k._id)}
                className={clsx('px-4 py-2 rounded-xl text-sm font-semibold border whitespace-nowrap', k._id === childId ? 'bg-blue text-white border-blue' : 'bg-white border-border text-gray-600')}>
                {k.fullName}<span className="opacity-70 font-normal"> · {k.className}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1 mb-3 border-b border-border overflow-x-auto">
          {tabs.map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={clsx('flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px whitespace-nowrap',
                tab === k ? 'border-blue text-blue' : 'border-transparent text-gray-400')}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'report' && <ChildReport studentId={childId} />}
      {tab === 'attendance' && <Attendance studentId={childId} />}
      {tab === 'fees' && <Fees studentId={childId} onlinePayment={online} />}
      {tab === 'notices' && <Notices />}
    </div>
  )
}
