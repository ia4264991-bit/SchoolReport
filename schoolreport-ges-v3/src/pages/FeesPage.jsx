import { useEffect, useState } from 'react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { useSchoolStore } from '@/store/schoolStore'
import api, { errorMessage } from '@/lib/api'
import { cedis, formatDate, todayIso } from '@/lib/format'
import { Receipt } from '@/components/report/PrintSheets'
import { Card, SectionHeader, Button, Select, Input, Field, Modal, Table, Tr, Td, Badge, Spinner, EmptyState, Alert, Metric, PageHeader } from '@/components/ui'
import { Wallet, Plus, Trash2, Receipt as ReceiptIcon, Printer, Send, Banknote, Users, ListChecks, CalendarDays, Ban, Pencil } from 'lucide-react'

const METHODS = [['cash', 'Cash'], ['momo', 'Mobile Money'], ['bank', 'Bank'], ['cheque', 'Cheque']]
const STATUS = { paid: ['green', 'Paid'], part: ['amber', 'Part paid'], owing: ['red', 'Owing'] }

/* ── A pupil's account: payments, "paid in full", discounts, receipts ─────── */
function PupilAccount({ studentId, canWrite, isAdmin, onClose, onChanged, onReceipt }) {
  const [st, setSt] = useState(null)
  const [pay, setPay] = useState({ amount: '', method: 'cash', reference: '', paidOn: todayIso(), note: '' })
  const [adj, setAdj] = useState(null) // { kind: 'charge' | 'discount', description, amount }
  const [busy, setBusy] = useState(false)

  const load = () => api.get(`/fees/students/${studentId}`).then((r) => setSt(r.data)).catch((e) => toast.error(errorMessage(e, 'Could not load the account')))
  useEffect(() => { load() }, [studentId])

  const record = async (override) => {
    const body = { ...pay, ...override, studentId }
    if (!(Number(body.amount) > 0)) return toast.error('Enter the amount received.')
    setBusy(true)
    try {
      const { data } = await api.post('/fees/payments', body)
      toast.success(data.message)
      setPay({ amount: '', method: 'cash', reference: '', paidOn: todayIso(), note: '' })
      await load(); onChanged()
      onReceipt(data.payment._id)
    } catch (e) { toast.error(errorMessage(e, 'Could not record the payment')) } finally { setBusy(false) }
  }
  const paidInFull = () => {
    if (!(st.balance > 0)) return toast('Nothing is owed.')
    if (confirm(`Record ${cedis(st.balance)} received in cash from ${st.student.fullName}? A receipt will be printed.`)) record({ amount: st.balance, method: 'cash' })
  }
  const saveAdj = async () => {
    const amount = Math.abs(Number(adj.amount)) * (adj.kind === 'discount' ? -1 : 1)
    if (!adj.description.trim() || !amount) return toast.error('Enter a description and an amount.')
    setBusy(true)
    try {
      await api.post('/fees/charges', { studentId, description: adj.description, amount })
      toast.success(adj.kind === 'discount' ? 'Discount added' : 'Charge added')
      setAdj(null); await load(); onChanged()
    } catch (e) { toast.error(errorMessage(e, 'Could not save')) } finally { setBusy(false) }
  }
  const removeCharge = async (c) => {
    if (!confirm(`Remove "${c.description}" (${cedis(c.amount)}) from this account?`)) return
    try { await api.delete(`/fees/charges/${c._id}`); await load(); onChanged() } catch (e) { toast.error(errorMessage(e, 'Could not remove')) }
  }
  const voidPayment = async (p) => {
    const reason = prompt(`Void receipt ${p.receiptNo} (${cedis(p.amount)})? It stays on record, marked VOID. Reason:`)
    if (!reason?.trim()) return
    try { await api.post(`/fees/payments/${p._id}/void`, { reason }); toast.success('Receipt voided'); await load(); onChanged() } catch (e) { toast.error(errorMessage(e, 'Could not void')) }
  }

  return (
    <Modal open onClose={onClose} title={st ? st.student.fullName : 'Account'}>
      {!st ? <Spinner /> : (
        <div>
          <div className={clsx('rounded-xl p-4 mb-3 text-center', st.balance > 0 ? 'bg-amber-light' : 'bg-green-light')}>
            <div className={clsx('text-2xl font-bold', st.balance > 0 ? 'text-amber' : 'text-green')}>{st.balance > 0 ? cedis(st.balance) : 'Fully paid'}</div>
            <div className="text-xs text-gray-500">{st.student.className} · charged {cedis(st.totalCharged)} · paid {cedis(st.totalPaid)}</div>
          </div>

          {canWrite && (
            <div className="border border-border rounded-xl p-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">Record a payment</div>
                {st.balance > 0 && <Button size="sm" variant="success" onClick={paidInFull} disabled={busy}><Banknote className="w-3.5 h-3.5" /> Paid in full (cash)</Button>}
              </div>
              <div className="grid grid-cols-2 gap-x-2">
                <Field label="Amount (GHS)"><Input type="number" min="0.01" step="0.01" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} /></Field>
                <Field label="Paid by"><Select value={pay.method} onChange={(e) => setPay((p) => ({ ...p, method: e.target.value }))}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
                <Field label="Date"><Input type="date" max={todayIso()} value={pay.paidOn} onChange={(e) => setPay((p) => ({ ...p, paidOn: e.target.value }))} /></Field>
                <Field label={pay.method === 'cash' ? 'Reference (optional)' : 'MoMo / bank reference'}><Input value={pay.reference} maxLength={80} onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))} /></Field>
              </div>
              <Button variant="primary" className="w-full" onClick={() => record()} disabled={busy}><ReceiptIcon className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save and print receipt'}</Button>
            </div>
          )}

          {canWrite && (
            adj ? (
              <div className="border border-border rounded-xl p-3 mb-3">
                <div className="grid grid-cols-2 gap-x-2">
                  <Field label="Type"><Select value={adj.kind} onChange={(e) => setAdj((a) => ({ ...a, kind: e.target.value }))}><option value="discount">Discount / scholarship</option><option value="charge">Extra charge</option></Select></Field>
                  <Field label="Amount (GHS)"><Input type="number" min="0.01" step="0.01" value={adj.amount} onChange={(e) => setAdj((a) => ({ ...a, amount: e.target.value }))} /></Field>
                </div>
                <Field label="Description"><Input value={adj.description} maxLength={120} placeholder={adj.kind === 'discount' ? 'e.g. Sibling discount' : 'e.g. Lost textbook'} onChange={(e) => setAdj((a) => ({ ...a, description: e.target.value }))} /></Field>
                <div className="flex gap-2 justify-end"><Button size="sm" onClick={() => setAdj(null)}>Cancel</Button><Button size="sm" variant="primary" onClick={saveAdj} disabled={busy}>Add</Button></div>
              </div>
            ) : (
              <Button size="sm" className="mb-3" onClick={() => setAdj({ kind: 'discount', description: '', amount: '' })}><Pencil className="w-3.5 h-3.5" /> Add a discount or charge</Button>
            )
          )}

          <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Account</div>
          <div className="divide-y divide-[#f0f4fb] text-sm">
            {st.charges.map((c) => (
              <div key={c._id} className="flex items-center gap-2 py-2">
                <span className="flex-1">{c.description} <span className="text-xs text-gray-400">· Term {c.term} {c.academicYear}</span></span>
                <span className={c.amount < 0 ? 'text-green' : ''}>{cedis(c.amount)}</span>
                {isAdmin && <button onClick={() => removeCharge(c)} className="p-1 text-gray-300 hover:text-red" aria-label="Remove charge"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            ))}
            {st.payments.map((p) => (
              <div key={p._id} className={clsx('flex items-center gap-2 py-2', p.voided && 'opacity-50 line-through')}>
                <span className="flex-1">Paid {formatDate(p.paidOn)} · {p.receiptNo}{p.voided && ' (void)'}</span>
                <span className="text-green">−{cedis(p.amount)}</span>
                <button onClick={() => onReceipt(p._id)} className="p-1 text-gray-400 hover:text-blue" aria-label="Receipt"><Printer className="w-3.5 h-3.5" /></button>
                {isAdmin && !p.voided && <button onClick={() => voidPayment(p)} className="p-1 text-gray-300 hover:text-red" aria-label="Void"><Ban className="w-3.5 h-3.5" /></button>}
              </div>
            ))}
            {!st.charges.length && !st.payments.length && <div className="py-3 text-gray-400 text-xs">Nothing on this account yet. Set the fee items for the term, then press "Bill pupils".</div>}
          </div>
        </div>
      )}
    </Modal>
  )
}

export default function FeesPage() {
  const { user } = useAuthStore()
  const { classes, fetchClasses, settings, logoUrl, fetchSettings } = useSchoolStore()
  const role = user?.role
  const canWrite = role === 'admin' || role === 'bursar'
  const isAdmin = role === 'admin'
  const [tab, setTab] = useState('overview')
  const [term, setTerm] = useState(settings?.term || '1')
  const [summary, setSummary] = useState(null)
  const [items, setItems] = useState(null)
  const [itemForm, setItemForm] = useState(null)
  const [classId, setClassId] = useState('')
  const [list, setList] = useState(null)
  const [account, setAccount] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const [day, setDay] = useState({ from: todayIso(), to: todayIso() })
  const [payments, setPayments] = useState(null)
  const [reminder, setReminder] = useState(null)
  const [school, setSchool] = useState(null)

  useEffect(() => { fetchClasses(); if (user?.schoolId) api.get(`/school/schools/${user.schoolId}`).then((r) => setSchool(r.data)).catch(() => {}) }, [])
  useEffect(() => { if (settings?.term) setTerm(settings.term) }, [settings?.term])

  const loadSummary = () => api.get('/fees/summary', { params: { term } }).then((r) => setSummary(r.data)).catch((e) => toast.error(errorMessage(e, 'Could not load fees')))
  const loadItems = () => api.get('/fees/items', { params: { term } }).then((r) => setItems(r.data)).catch(() => {})
  const loadList = () => classId && api.get(`/fees/classes/${classId}`, { params: { term } }).then((r) => setList(r.data)).catch((e) => toast.error(errorMessage(e, 'Could not load the class')))
  const loadPayments = () => api.get('/fees/payments', { params: day }).then((r) => setPayments(r.data)).catch(() => {})
  const refreshAll = () => { loadSummary(); loadList() }

  useEffect(() => { loadSummary(); loadItems() }, [term])
  useEffect(() => { setList(null); loadList() }, [classId, term])
  useEffect(() => { if (tab === 'payments') loadPayments() }, [tab, day.from, day.to])

  const saveItem = async () => {
    try {
      const body = { name: itemForm.name, amount: itemForm.amount, classId: itemForm.classId || null, term }
      itemForm._id ? await api.put(`/fees/items/${itemForm._id}`, body) : await api.post('/fees/items', body)
      setItemForm(null); loadItems()
    } catch (e) { toast.error(errorMessage(e, 'Could not save the fee item')) }
  }
  const deleteItem = async (it) => {
    if (!confirm(`Remove "${it.name}"? Pupils already billed keep it on their account.`)) return
    try { await api.delete(`/fees/items/${it._id}`); loadItems() } catch (e) { toast.error(errorMessage(e, 'Could not remove')) }
  }
  const bill = async () => {
    if (!confirm(`Put the Term ${term} fee items on every pupil's account? Pupils already billed are not billed twice.`)) return
    try { const { data } = await api.post('/fees/bill', { term }); toast.success(data.message); loadItems(); refreshAll() } catch (e) { toast.error(errorMessage(e, 'Billing failed')) }
  }
  const toggleOnline = async () => {
    try {
      await api.put('/school/settings', { onlineFeePayments: !settings.onlineFeePayments })
      await fetchSettings()
      toast.success(settings.onlineFeePayments ? 'Online payment switched off — parents pay at the school office.' : 'Online payment switched on.')
    } catch (e) { toast.error(errorMessage(e, 'Could not change the setting')) }
  }
  const openReceipt = async (paymentId) => {
    try { const { data } = await api.get(`/fees/payments/${paymentId}`); setAccount(null); setReceipt(data) } catch (e) { toast.error(errorMessage(e, 'Could not load the receipt')) }
  }
  const previewReminders = async () => {
    try { const { data } = await api.get('/fees/reminders', { params: classId ? { classId } : {} }); setReminder(data) } catch (e) { toast.error(errorMessage(e, 'Could not prepare reminders')) }
  }
  const sendReminders = async () => {
    try { const { data } = await api.post('/fees/reminders', classId ? { classId } : {}); toast.success(data.message); setReminder(null) } catch (e) { toast.error(errorMessage(e, 'Could not send')) }
  }

  if (receipt) {
    return (
      <div>
        <div className="flex justify-end gap-2 mb-3 no-print">
          <Button onClick={() => setReceipt(null)}>← Back</Button>
          <Button variant="primary" onClick={() => window.print()}><Printer className="w-3.5 h-3.5" /> Print receipt</Button>
        </div>
        <Receipt payment={receipt} schoolName={settings?.schoolName || ''} logoUrl={logoUrl} />
      </div>
    )
  }

  const tabs = [['overview', 'Overview', Wallet], ['items', 'Fee items', ListChecks], ['pupils', 'Pupils', Users], ['payments', 'Payments', CalendarDays]]
  return (
    <div>
      <PageHeader title="School fees" subtitle={`Term ${term}${settings?.academicYear ? `, ${settings.academicYear}` : ''}`}>
        <Select className="w-28" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Term">
          <option value="1">Term 1</option><option value="2">Term 2</option><option value="3">Term 3</option>
        </Select>
      </PageHeader>

      <div className="flex gap-1 mb-4 border-b border-border overflow-x-auto">
        {tabs.map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={clsx('flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px whitespace-nowrap',
            tab === k ? 'border-blue text-blue' : 'border-transparent text-gray-400 hover:text-gray-600')}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (!summary ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Metric icon={Wallet} value={cedis(summary.totals.billed)} label="Billed this term" color="blue" />
            <Metric icon={Banknote} value={cedis(summary.totals.collected)} label="Collected this term" color="green" />
            <Metric icon={Users} value={cedis(summary.totals.owed)} label="Still owed (all terms)" color="red" />
            <Metric icon={CalendarDays} value={cedis(summary.today.collected)} label={`Today · ${summary.today.payments} payment(s)`} color="amber" />
          </div>
          {isAdmin && settings && (
            <Card>
              <SectionHeader title="How parents can pay">
                <Button size="sm" variant={settings.onlineFeePayments ? 'danger' : 'success'} onClick={toggleOnline}>
                  {settings.onlineFeePayments ? 'Turn online payment off' : 'Turn online payment on'}
                </Button>
              </SectionHeader>
              <p className="text-sm text-gray-600">
                {settings.onlineFeePayments
                  ? 'Parents can pay at the school office, and also online with MoMo or a card in the parent app.'
                  : 'Parents pay at the school office only. Record each payment here and print the receipt.'}
                {settings.onlineFeePayments && !school?.paystackSubaccount && ' (Online payment starts once SchoolReport has connected your school\'s Paystack account — contact us.)'}
              </p>
            </Card>
          )}
          <Card>
            <SectionHeader title="By class" />
            <Table headers={['Class', 'Pupils', 'Billed', 'Collected', 'Owed', '']}>
              {summary.classes.map((c) => (
                <Tr key={c.classId}>
                  <Td className="font-medium">{c.className}</Td><Td>{c.pupils}</Td>
                  <Td>{cedis(c.billed)}</Td><Td className="text-green">{cedis(c.collected)}</Td>
                  <Td className={c.owed > 0 ? 'text-red font-semibold' : ''}>{cedis(c.owed)}</Td>
                  <Td><Button size="sm" onClick={() => { setClassId(c.classId); setTab('pupils') }}>Open</Button></Td>
                </Tr>
              ))}
            </Table>
          </Card>
        </>
      ))}

      {tab === 'items' && (
        <Card>
          <SectionHeader title={`What Term ${term} costs`}>
            {canWrite && <Button size="sm" variant="primary" onClick={() => setItemForm({ name: '', amount: '', classId: '' })}><Plus className="w-3.5 h-3.5" /> Add fee item</Button>}
            {canWrite && items?.items.length > 0 && <Button size="sm" variant="success" onClick={bill}><Send className="w-3.5 h-3.5" /> Bill pupils</Button>}
          </SectionHeader>
          {!items ? <Spinner /> : items.items.length === 0 ? (
            <EmptyState icon={ListChecks} title="No fee items for this term" description="Add items such as Tuition, PTA levy or Feeding, for all classes or one class, then press Bill pupils." />
          ) : (
            <Table headers={['Item', 'Class', 'Amount', 'Pupils billed', '']}>
              {items.items.map((it) => (
                <Tr key={it._id}>
                  <Td className="font-medium">{it.name}</Td><Td>{it.className || 'All classes'}</Td><Td>{cedis(it.amount)}</Td><Td>{it.billed}</Td>
                  <Td>{canWrite && (
                    <div className="flex gap-1.5 justify-end">
                      <Button size="sm" onClick={() => setItemForm({ _id: it._id, name: it.name, amount: String(it.amount), classId: it.classId || '' })}><Pencil className="w-3 h-3" /></Button>
                      <Button size="sm" variant="danger" onClick={() => deleteItem(it)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  )}</Td>
                </Tr>
              ))}
            </Table>
          )}
          <Alert variant="info">Changing an amount affects pupils billed after the change. "Bill pupils" never charges anyone twice, so press it again after adding new pupils.</Alert>
        </Card>
      )}

      {tab === 'pupils' && (
        <Card>
          <SectionHeader title={list ? `${list.class.name} · owed ${cedis(list.totals.owed)}` : 'Pupils'}>
            <Select className="w-40" value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
              <option value="">Select class…</option>
              {classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
            {canWrite && <Button size="sm" onClick={previewReminders}><Send className="w-3.5 h-3.5" /> SMS reminders</Button>}
          </SectionHeader>
          {!classId ? <EmptyState icon={Users} title="Choose a class" /> : !list ? <Spinner /> : (
            <Table headers={['Pupil', 'This term', 'Paid', 'Balance', 'Status']}>
              {list.pupils.map((p) => (
                <Tr key={p._id} onClick={() => setAccount(p._id)}>
                  <Td className="font-medium">{p.fullName}</Td>
                  <Td>{cedis(p.termCharged)}</Td><Td className="text-green">{cedis(p.termPaid)}</Td>
                  <Td className={p.balance > 0 ? 'font-semibold text-red' : ''}>{p.balance > 0 ? cedis(p.balance) : '—'}</Td>
                  <Td><Badge variant={STATUS[p.status][0]}>{STATUS[p.status][1]}</Badge></Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'payments' && (
        <Card>
          <SectionHeader title={payments ? `Received: ${cedis(payments.total)}` : 'Payments'}>
            <Input type="date" className="w-40" value={day.from} max={todayIso()} onChange={(e) => setDay((d) => ({ ...d, from: e.target.value }))} aria-label="From" />
            <Input type="date" className="w-40" value={day.to} max={todayIso()} onChange={(e) => setDay((d) => ({ ...d, to: e.target.value }))} aria-label="To" />
          </SectionHeader>
          {!payments ? <Spinner /> : payments.payments.length === 0 ? <EmptyState icon={CalendarDays} title="No payments in these days" /> : (
            <>
              <div className="flex flex-wrap gap-2 mb-3 text-xs">
                {Object.entries(payments.byMethod).map(([m, v]) => <Badge key={m} variant="blue">{(METHODS.find(([k]) => k === m)?.[1]) || 'Online'}: {cedis(v)}</Badge>)}
              </div>
              <Table headers={['Date', 'Receipt', 'Pupil', 'Amount', 'By', '']}>
                {payments.payments.map((p) => (
                  <Tr key={p._id}>
                    <Td className="text-xs">{formatDate(p.paidOn)}</Td>
                    <Td className={clsx('text-xs', p.voided && 'line-through text-gray-400')}>{p.receiptNo}</Td>
                    <Td>{p.pupil} <span className="text-xs text-gray-400">{p.className}</span></Td>
                    <Td className={p.voided ? 'line-through text-gray-400' : 'font-semibold'}>{cedis(p.amount)}</Td>
                    <Td className="text-xs text-gray-500">{p.receivedBy}</Td>
                    <Td><Button size="sm" onClick={() => openReceipt(p._id)}><Printer className="w-3 h-3" /></Button></Td>
                  </Tr>
                ))}
              </Table>
            </>
          )}
        </Card>
      )}

      {account && <PupilAccount studentId={account} canWrite={canWrite} isAdmin={isAdmin} onClose={() => setAccount(null)} onChanged={refreshAll} onReceipt={openReceipt} />}

      <Modal open={Boolean(itemForm)} onClose={() => setItemForm(null)} title={itemForm?._id ? 'Edit fee item' : 'Add fee item'}
        footer={<><Button onClick={() => setItemForm(null)}>Cancel</Button><Button variant="primary" onClick={saveItem}>Save</Button></>}>
        {itemForm && <>
          <Field label="Name"><Input value={itemForm.name} maxLength={80} placeholder="e.g. Tuition" onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Amount (GHS)"><Input type="number" min="0.01" step="0.01" value={itemForm.amount} onChange={(e) => setItemForm((f) => ({ ...f, amount: e.target.value }))} /></Field>
          <Field label="For">
            <Select value={itemForm.classId} onChange={(e) => setItemForm((f) => ({ ...f, classId: e.target.value }))}>
              <option value="">All classes</option>
              {classes.map((c) => <option key={c._id} value={c._id}>{c.name} only</option>)}
            </Select>
          </Field>
        </>}
      </Modal>

      <Modal open={Boolean(reminder)} onClose={() => setReminder(null)} title="Fee reminders by SMS"
        footer={<><Button onClick={() => setReminder(null)}>Cancel</Button><Button variant="primary" onClick={sendReminders} disabled={!reminder?.pupils}>Send {reminder?.smsCost || 0} SMS</Button></>}>
        {reminder && (reminder.pupils === 0
          ? <p className="text-sm text-gray-600">No pupil with an unpaid balance has a parent phone number{classId ? ' in this class' : ''}.</p>
          : <>
              <p className="text-sm text-gray-600 mb-2">Parents of <b>{reminder.pupils}</b> pupil(s) who owe ({reminder.phones} phone numbers). Uses <b>{reminder.smsCost}</b> SMS; your school has {reminder.leftThisMonth} left this month.</p>
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">Example: {reminder.sample}</div>
            </>)}
      </Modal>
    </div>
  )
}
