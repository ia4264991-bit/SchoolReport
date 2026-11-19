import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import api, { errorMessage } from '@/lib/api'
import { cedis, formatDate } from '@/lib/format'
import { Card, SectionHeader, Button, Table, Tr, Td, Badge, Spinner, Alert, PageHeader } from '@/components/ui'
import { CreditCard } from 'lucide-react'

const STATUS = {
  active: ['green', 'Active'],
  grace: ['amber', 'Ended — grace period'],
  locked: ['red', 'Ended — read-only'],
}

/** The school's own subscription: status, price for the next term, pay online, history. */
export default function BillingPage() {
  const { user, refreshUser } = useAuthStore()
  const [params, setParams] = useSearchParams()
  const [b, setB] = useState(null)
  const [busy, setBusy] = useState(false)
  const isAdmin = user?.role === 'admin'

  const load = () => api.get('/billing').then((r) => setB(r.data)).catch((e) => toast.error(errorMessage(e, 'Could not load billing')))
  useEffect(() => { load() }, [])

  // Back from Paystack.
  useEffect(() => {
    const reference = params.get('reference') || params.get('trxref')
    if (!reference) return
    setParams({}, { replace: true })
    api.get(`/payments/paystack/verify/${encodeURIComponent(reference)}`)
      .then(({ data }) => {
        if (data.status === 'success') toast.success(`Thank you! Paid until ${formatDate(data.paidUntil)}.`, { duration: 8000 })
        else if (data.status === 'pending') toast('The payment is still being confirmed. Refresh in a few minutes.', { duration: 8000 })
        else toast.error('The payment did not go through.')
        load(); refreshUser()
      })
      .catch((e) => toast.error(errorMessage(e, 'Could not confirm the payment')))
  }, [])

  const pay = async () => {
    setBusy(true)
    try {
      const { data } = await api.post('/billing/pay')
      window.location.assign(data.authorizationUrl)
    } catch (e) { toast.error(errorMessage(e, 'Could not start the payment')); setBusy(false) }
  }

  if (!b) return <Spinner />
  const [color, label] = STATUS[b.status] || STATUS.active
  const q = b.quote
  return (
    <div>
      <PageHeader title="Billing" subtitle="Your SchoolReport subscription" />
      <Card>
        <SectionHeader title="Status"><Badge variant={color}>{label}</Badge></SectionHeader>
        {b.plan === 'complimentary' && <p className="text-sm text-gray-600">Your school is on a complimentary plan set up by SchoolReport. Nothing to pay.</p>}
        {b.plan === 'trial' && b.status === 'active' && <p className="text-sm text-gray-600">Free trial: <b>{b.daysLeft} day(s) left</b> (until {formatDate(b.endsAt)}).</p>}
        {b.plan === 'paid' && b.status === 'active' && <p className="text-sm text-gray-600">Paid until <b>{formatDate(b.paidUntil)}</b>.</p>}
        {b.status === 'grace' && <Alert variant="warn">Your {b.plan === 'trial' ? 'trial' : 'subscription'} ended on {formatDate(b.endsAt)}. Everything still works until {formatDate(b.graceEndsAt)}; after that the school becomes read-only until you pay.</Alert>}
        {b.status === 'locked' && <Alert variant="err">Your school is read-only: you can view and print everything, but not make changes. Pay below to unlock it straight away.</Alert>}
      </Card>

      <Card>
        <SectionHeader title={`One term (${q.termMonths} months)`} />
        <div className="text-3xl font-bold text-blue">{cedis(q.amount)}</div>
        <p className="text-sm text-gray-500 mt-1">
          {cedis(q.perPupil)} per pupil × {q.pupils} pupil(s) on roll{q.amount === q.minimum && q.pupils * q.perPupil < q.minimum ? `, minimum ${cedis(q.minimum)}` : ''}.
          Paying early adds the term after your current one — no days are lost.
        </p>
        {isAdmin && (b.onlinePayment
          ? <Button variant="primary" size="lg" className="mt-4" onClick={pay} disabled={busy}><CreditCard className="w-4 h-4" /> {busy ? 'Opening…' : 'Pay with MoMo or card'}</Button>
          : <Alert variant="info">Online payment is not available yet. Pay by bank transfer or MoMo and send us the reference; we will record it.</Alert>)}
        {!isAdmin && <p className="text-xs text-gray-400 mt-3">Only the school admin can pay.</p>}
      </Card>

      {b.history.length > 0 && (
        <Card>
          <SectionHeader title="Payments" />
          <Table headers={['Paid', 'Amount', 'Pupils', 'Covers', 'How']}>
            {b.history.map((p) => (
              <Tr key={p._id}>
                <Td className="text-xs">{formatDate(p.createdAt)}</Td><Td>{cedis(p.amount)}</Td><Td>{p.pupils}</Td>
                <Td className="text-xs">{formatDate(p.periodStart)} – {formatDate(p.periodEnd)}</Td>
                <Td className="text-xs">{p.method === 'online' ? 'Online' : `Recorded by SchoolReport${p.reference ? ` (${p.reference})` : ''}`}</Td>
              </Tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  )
}
