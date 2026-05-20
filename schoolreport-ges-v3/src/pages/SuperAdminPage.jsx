import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { Card, SectionHeader, Button, Table, Tr, Td, Badge, Modal, Field, Input, Spinner, EmptyState, Alert, PageHeader } from '@/components/ui'
import { Building2, Plus, ToggleLeft, ToggleRight, CheckCircle, XCircle, Copy, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'

export default function SuperAdminPage() {
  const [schools, setSchools] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [created, setCreated] = useState(null)
  const [showPw,  setShowPw]  = useState(false)
  const [form, setForm] = useState({ schoolName:'', schoolEmail:'', adminName:'', adminEmail:'', circuit:'', district:'', region:'' })
  const [err, setErr] = useState('')

  const load = async () => {
    try { const { data } = await api.get('/superadmin/schools'); setSchools(data) }
    catch { toast.error('Failed to load schools') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const openModal = () => {
    setForm({ schoolName:'', schoolEmail:'', adminName:'', adminEmail:'', circuit:'', district:'', region:'' })
    setErr(''); setModal(true)
  }

  const save = async () => {
    const { schoolName, schoolEmail, adminName, adminEmail } = form
    if (!schoolName || !schoolEmail || !adminName || !adminEmail)
      return setErr('School name, school email, admin name and admin email are all required.')
    setSaving(true)
    try {
      const { data } = await api.post('/superadmin/schools', form)
      setModal(false)
      setCreated(data)
      setShowPw(false)
      load()
    } catch (e) { setErr(e.response?.data?.message || 'Failed to create school.') }
    finally { setSaving(false) }
  }

  const copy = (text) => { navigator.clipboard.writeText(text); toast.success('Copied to clipboard!') }

  const toggle = async (id, name, isActive) => {
    if (!confirm(`${isActive ? 'Deactivate' : 'Activate'} "${name}"?`)) return
    try {
      const { data } = await api.put(`/superadmin/schools/${id}/toggle`)
      toast.success(data.message)
      setSchools(ss => ss.map(s => s._id === id ? { ...s, isActive: !s.isActive } : s))
    } catch { toast.error('Failed to update school') }
  }

  return (
    <div>
      <PageHeader title="Platform Control" subtitle="Manage all schools on SchoolReport GES" />

      <div className="grid grid-cols-3 gap-3 mb-5">
        {[['Total', schools.length, 'bg-blue-light text-blue'],
          ['Active', schools.filter(s=>s.isActive).length, 'bg-green-light text-green'],
          ['Inactive', schools.filter(s=>!s.isActive).length, 'bg-red-light text-red']
        ].map(([l,v,c]) => (
          <div key={l} className={`rounded-xl p-4 text-center ${c}`}>
            <div className="text-2xl font-bold">{v}</div>
            <div className="text-xs mt-0.5 opacity-80">{l} Schools</div>
          </div>
        ))}
      </div>

      <Card>
        <SectionHeader title={`Schools (${schools.length})`}>
          <Button variant="primary" size="sm" onClick={openModal}><Plus className="w-3.5 h-3.5" /> Create School</Button>
        </SectionHeader>
        {loading ? <Spinner /> : schools.length === 0 ? (
          <EmptyState icon={Building2} title="No schools yet" description="Create your first school to get started." />
        ) : (
          <Table headers={['School','Email','Region','Status','']}>
            {schools.map(s => (
              <Tr key={s._id}>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-light flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-4 h-4 text-blue" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{s.name}</div>
                      {s.district && <div className="text-[11px] text-gray-400">{s.district}</div>}
                    </div>
                  </div>
                </Td>
                <Td className="text-gray-500 text-xs">{s.email}</Td>
                <Td className="text-gray-500 text-sm">{s.region || '—'}</Td>
                <Td>{s.isActive
                  ? <Badge variant="green"><CheckCircle className="w-3 h-3 inline mr-1"/>Active</Badge>
                  : <Badge variant="red"><XCircle className="w-3 h-3 inline mr-1"/>Inactive</Badge>}
                </Td>
                <Td>
                  <Button size="sm" variant={s.isActive ? 'danger' : 'success'}
                    onClick={() => toggle(s._id, s.name, s.isActive)}>
                    {s.isActive ? <><ToggleLeft className="w-3.5 h-3.5"/> Deactivate</> : <><ToggleRight className="w-3.5 h-3.5"/> Activate</>}
                  </Button>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* CREATE SCHOOL MODAL */}
      <Modal open={modal} onClose={() => setModal(false)} title="Create New School"
        footer={<><Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create School'}</Button></>}>
        <Alert variant="info">Credentials are shown after creation AND emailed to the admin.</Alert>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">School Details</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
          <div className="sm:col-span-2"><Field label="School Name *"><Input value={form.schoolName} onChange={e=>setForm(f=>({...f,schoolName:e.target.value}))} placeholder="e.g. Accra Basic School"/></Field></div>
          <Field label="School Email *"><Input type="email" value={form.schoolEmail} onChange={e=>setForm(f=>({...f,schoolEmail:e.target.value}))} placeholder="school@example.com"/></Field>
          <Field label="Region"><Input value={form.region} onChange={e=>setForm(f=>({...f,region:e.target.value}))} placeholder="e.g. Greater Accra"/></Field>
          <Field label="District"><Input value={form.district} onChange={e=>setForm(f=>({...f,district:e.target.value}))} placeholder="e.g. Accra Metro"/></Field>
          <Field label="Circuit"><Input value={form.circuit} onChange={e=>setForm(f=>({...f,circuit:e.target.value}))} placeholder="e.g. Osu Circuit"/></Field>
        </div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 mt-2">Admin Account</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
          <Field label="Admin Full Name *"><Input value={form.adminName} onChange={e=>setForm(f=>({...f,adminName:e.target.value}))} placeholder="e.g. Mr. Kofi Asante"/></Field>
          <Field label="Admin Email *"><Input type="email" value={form.adminEmail} onChange={e=>setForm(f=>({...f,adminEmail:e.target.value}))} placeholder="admin@example.com"/></Field>
        </div>
        {err && <div className="text-red text-xs bg-red-light border border-red-200 rounded-lg px-3 py-2.5 mt-2">{err}</div>}
      </Modal>

      {/* CREDENTIALS MODAL — shown after school creation */}
      {created && (
        <Modal open={!!created} onClose={() => { setCreated(null); setShowPw(false) }}
          title="✅ School Created"
          footer={<Button variant="primary" onClick={() => { setCreated(null); setShowPw(false) }}>Done</Button>}>

          {created.emailSent ? (
            <div className="flex items-center gap-2 bg-green-light border border-green-200 rounded-xl px-4 py-3 mb-4">
              <CheckCircle className="w-4 h-4 text-green flex-shrink-0"/>
              <span className="text-sm text-green font-medium">Credentials emailed to <strong>{created.credentials.email}</strong></span>
            </div>
          ) : (
            <div className="flex items-start gap-2 bg-amber-light border border-[#FAC775] rounded-xl px-4 py-3 mb-4">
              <span className="text-lg flex-shrink-0">⚠️</span>
              <div>
                <p className="text-sm text-amber font-bold">Email delivery failed</p>
                <p className="text-xs text-amber mt-0.5">Share these credentials manually with the admin now.</p>
              </div>
            </div>
          )}

          <div className="bg-[#f4f6fb] rounded-xl p-4 mb-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Admin Credentials</p>
            {[{ label:'Login URL', value: created.credentials.loginUrl },
              { label:'Email',    value: created.credentials.email }
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-border">
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">{label}</p>
                  <p className="text-sm font-semibold text-gray-800 break-all">{value}</p>
                </div>
                <button onClick={() => copy(value)} className="p-1.5 rounded-lg hover:bg-blue-light text-gray-400 hover:text-blue transition-all ml-2 flex-shrink-0">
                  <Copy className="w-3.5 h-3.5"/>
                </button>
              </div>
            ))}
            {/* Password with show/hide */}
            <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-[#FAC775]">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Password</p>
                <p className="text-sm font-bold text-red tracking-widest font-mono">
                  {showPw ? created.credentials.password : '••••••••••'}
                </p>
              </div>
              <div className="flex gap-1.5 ml-2">
                <button onClick={() => setShowPw(v => !v)} className="p-1.5 rounded-lg hover:bg-amber-light text-gray-400 hover:text-amber transition-all">
                  {showPw ? <EyeOff className="w-3.5 h-3.5"/> : <Eye className="w-3.5 h-3.5"/>}
                </button>
                <button onClick={() => copy(created.credentials.password)} className="p-1.5 rounded-lg hover:bg-blue-light text-gray-400 hover:text-blue transition-all">
                  <Copy className="w-3.5 h-3.5"/>
                </button>
              </div>
            </div>
          </div>

          <Alert variant="warn">🔒 Save these credentials now. The password cannot be retrieved later — only reset.</Alert>
        </Modal>
      )}
    </div>
  )
}
