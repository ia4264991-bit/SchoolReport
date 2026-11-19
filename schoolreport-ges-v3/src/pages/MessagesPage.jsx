import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useSchoolStore } from '@/store/schoolStore'
import api, { errorMessage } from '@/lib/api'
import { shortDate } from '@/lib/format'
import { Card, SectionHeader, Button, Select, Input, Textarea, Field, Modal, Badge, Spinner, EmptyState, Alert, PageHeader } from '@/components/ui'
import { Megaphone, Send, MessageSquare, Trash2, BellRing } from 'lucide-react'

// Rough SMS cost shown while typing (the server counts exactly).
const segments = (text) => {
  const n = [...text].length
  // eslint-disable-next-line no-control-regex
  const plain = /^[\x00-\x7F£¥èéùìòÇØøÅåÄÖÑÜäöñüà€]*$/.test(text)
  return plain ? (n <= 160 ? 1 : Math.ceil(n / 153)) : (n <= 70 ? 1 : Math.ceil(n / 67))
}

export default function MessagesPage() {
  const { classes, fetchClasses, settings, fetchSettings } = useSchoolStore()
  const [usage, setUsage] = useState(null)
  const [notices, setNotices] = useState(null)
  const [form, setForm] = useState({ title: '', body: '', classId: '', sendSms: true })
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState({ classId: '', term: settings?.term || '1', preview: null })

  const load = () => {
    api.get('/messages/usage').then((r) => setUsage(r.data)).catch(() => {})
    api.get('/messages/notices').then((r) => setNotices(r.data)).catch(() => setNotices([]))
  }
  useEffect(() => { fetchClasses(); load() }, [])

  const smsText = `${settings?.schoolName || ''}: ${form.title}. ${form.body}`
  const perPhone = segments(smsText)

  const post = async () => {
    if (!form.title.trim() || !form.body.trim()) return toast.error('Write a title and a message.')
    setSending(true)
    try {
      const { data } = await api.post('/messages/notices', { ...form, classId: form.classId || undefined })
      toast.success(data.message)
      setForm({ title: '', body: '', classId: '', sendSms: true })
      load()
    } catch (e) { toast.error(errorMessage(e, 'Could not send the notice')) } finally { setSending(false) }
  }
  const remove = async (n) => {
    if (!confirm(`Remove "${n.title}" from the parent app? SMS already sent cannot be recalled.`)) return
    try { await api.delete(`/messages/notices/${n._id}`); load() } catch (e) { toast.error(errorMessage(e, 'Could not remove')) }
  }
  const toggleAlerts = async () => {
    try {
      await api.put('/school/settings', { smsAbsenceAlerts: !settings.smsAbsenceAlerts })
      await fetchSettings(); load()
      toast.success(settings.smsAbsenceAlerts ? 'Absence alerts switched off.' : 'Absence alerts switched on: parents get an SMS when their child is marked absent.')
    } catch (e) { toast.error(errorMessage(e, 'Could not change the setting')) }
  }
  const previewResults = async () => {
    try {
      const { data } = await api.get(`/messages/results/${results.classId}/${results.term}`)
      setResults((r) => ({ ...r, preview: data }))
    } catch (e) { toast.error(errorMessage(e, 'Could not prepare the results')) }
  }
  const sendResults = async () => {
    try {
      const { data } = await api.post(`/messages/results/${results.classId}/${results.term}`)
      toast.success(data.message); setResults((r) => ({ ...r, preview: null })); load()
    } catch (e) { toast.error(errorMessage(e, 'Could not send')) }
  }

  return (
    <div>
      <PageHeader title="Messages to parents" subtitle="Notices in the parent app, and SMS" />

      {usage && (
        <Card>
          <SectionHeader title="SMS this month">
            <Badge variant={usage.leftThisMonth > 20 ? 'green' : 'red'}>{usage.usedThisMonth} used · {usage.leftThisMonth} left of {usage.monthlyLimit}</Badge>
          </SectionHeader>
          {!usage.smsConfigured && <Alert variant="warn">SMS sending is not switched on for the platform yet: notices still appear in the parent app.</Alert>}
          <div className="text-sm text-gray-600">
            {usage.guardianPhones} parent phone numbers on record for {usage.pupils} pupils.
            {usage.pupilsWithoutPhone > 0 && <span className="text-amber"> {usage.pupilsWithoutPhone} pupil(s) have no parent phone yet — add them on the Students page.</span>}
          </div>
          {settings && (
            <div className="flex flex-wrap items-center justify-between gap-2 mt-3 p-3 rounded-xl bg-[#f8faff] border border-border">
              <div className="text-sm"><BellRing className="w-4 h-4 inline mr-1 text-blue" /><b>Absence alerts</b>: {settings.smsAbsenceAlerts ? 'ON — parents get an SMS when their child is marked absent (one per day).' : 'OFF'}</div>
              <Button size="sm" variant={settings.smsAbsenceAlerts ? 'danger' : 'success'} onClick={toggleAlerts}>{settings.smsAbsenceAlerts ? 'Turn off' : 'Turn on'}</Button>
            </div>
          )}
        </Card>
      )}

      <Card>
        <SectionHeader title="New notice" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-3">
          <Field label="Title" className="sm:col-span-2"><Input value={form.title} maxLength={80} placeholder="e.g. PTA meeting" onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></Field>
          <Field label="To">
            <Select value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))}>
              <option value="">All parents</option>
              {classes.map((c) => <option key={c._id} value={c._id}>Parents of {c.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={`Message (${form.body.length}/480)`}>
          <Textarea value={form.body} maxLength={480} placeholder="e.g. There will be a PTA meeting on Friday at 2pm in the school hall." onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
        </Field>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={form.sendSms} onChange={(e) => setForm((f) => ({ ...f, sendSms: e.target.checked }))} className="w-4 h-4" />
          Also send by SMS ({perPhone} SMS per phone)
        </label>
        <Button variant="primary" onClick={post} disabled={sending}><Send className="w-3.5 h-3.5" /> {sending ? 'Sending…' : 'Send notice'}</Button>
      </Card>

      <Card>
        <SectionHeader title="Send results by SMS" />
        <p className="text-sm text-gray-500 mb-3">Each parent gets their child's average, position and attendance, and a link to the full report in the parent app.</p>
        <div className="flex flex-wrap gap-2">
          <Select className="w-40" value={results.classId} onChange={(e) => setResults((r) => ({ ...r, classId: e.target.value }))} aria-label="Class">
            <option value="">Select class…</option>
            {classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </Select>
          <Select className="w-28" value={results.term} onChange={(e) => setResults((r) => ({ ...r, term: e.target.value }))} aria-label="Term">
            <option value="1">Term 1</option><option value="2">Term 2</option><option value="3">Term 3</option>
          </Select>
          <Button onClick={previewResults} disabled={!results.classId}><MessageSquare className="w-3.5 h-3.5" /> Preview</Button>
        </div>
      </Card>

      <Card>
        <SectionHeader title="Notices sent" />
        {!notices ? <Spinner /> : !notices.length ? <EmptyState icon={Megaphone} title="No notices yet" /> : notices.map((n) => (
          <div key={n._id} className="py-3 border-b border-[#f0f4fb] last:border-0">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-sm">{n.title} <Badge variant="gray" className="ml-1">{n.className || 'All parents'}</Badge></div>
              <button onClick={() => remove(n)} className="p-1 text-gray-300 hover:text-red" aria-label="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            <p className="text-sm text-gray-600 whitespace-pre-line mt-1">{n.body}</p>
            <div className="text-[11px] text-gray-400 mt-1">{shortDate(n.createdAt)} · {n.sentBy}{n.smsRecipients ? ` · SMS to ${n.smsRecipients} phones` : ''}</div>
          </div>
        ))}
      </Card>

      <Modal open={Boolean(results.preview)} onClose={() => setResults((r) => ({ ...r, preview: null }))} title="Send results by SMS"
        footer={<><Button onClick={() => setResults((r) => ({ ...r, preview: null }))}>Cancel</Button><Button variant="primary" onClick={sendResults} disabled={!results.preview?.pupils}>Send {results.preview?.smsCost || 0} SMS</Button></>}>
        {results.preview && <>
          <p className="text-sm text-gray-600 mb-2">
            {results.preview.class}, Term {results.preview.term}: parents of <b>{results.preview.pupils}</b> pupil(s), {results.preview.phones} phone numbers.
            Uses <b>{results.preview.smsCost}</b> SMS; {results.preview.leftThisMonth} left this month.
            {results.preview.pupilsWithoutPhone > 0 && ` ${results.preview.pupilsWithoutPhone} pupil(s) have no parent phone.`}
          </p>
          {results.preview.sample && <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">Example: {results.preview.sample}</div>}
        </>}
      </Modal>
    </div>
  )
}
