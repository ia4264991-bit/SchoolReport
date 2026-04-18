import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { Card, SectionHeader, Button, Table, Tr, Td, Badge, Modal, Field, Input, Spinner, EmptyState, Alert } from '@/components/ui'
import { Building2, Plus, ToggleLeft, ToggleRight, Users, CheckCircle, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'

export default function SuperAdminPage() {
  const [schools, setSchools] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    schoolName: '', schoolEmail: '', adminName: '', adminEmail: '',
    circuit: '', district: '', region: ''
  })
  const [err, setErr] = useState('')

  const fetchSchools = async () => {
    try {
      const { data } = await api.get('/superadmin/schools')
      setSchools(data)
    } catch { toast.error('Failed to load schools') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchSchools() }, [])

  const openModal = () => {
    setForm({ schoolName: '', schoolEmail: '', adminName: '', adminEmail: '', circuit: '', district: '', region: '' })
    setErr('')
    setModal(true)
  }

  const save = async () => {
    const { schoolName, schoolEmail, adminName, adminEmail } = form
    if (!schoolName || !schoolEmail || !adminName || !adminEmail) {
      return setErr('School name, school email, admin name and admin email are all required.')
    }
    setSaving(true)
    try {
      const { data } = await api.post('/superadmin/schools', form)
      toast.success(data.message)
      setModal(false)
      fetchSchools()
    } catch (e) {
      setErr(e.response?.data?.message || 'Failed to create school.')
    } finally { setSaving(false) }
  }

  const toggleSchool = async (id, name, currentStatus) => {
    if (!confirm(`${currentStatus ? 'Deactivate' : 'Activate'} school "${name}"?`)) return
    try {
      const { data } = await api.put(`/superadmin/schools/${id}/toggle`)
      toast.success(data.message)
      setSchools(ss => ss.map(s => s._id === id ? { ...s, isActive: !s.isActive } : s))
    } catch { toast.error('Failed to update school status') }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Super Admin — Platform Control</h1>
        <p className="text-sm text-gray-400">Manage all schools on the SchoolReport GES platform</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          ['Total Schools', schools.length, 'bg-blue-light text-blue'],
          ['Active Schools', schools.filter(s => s.isActive).length, 'bg-green-light text-green'],
          ['Inactive Schools', schools.filter(s => !s.isActive).length, 'bg-red-light text-red'],
        ].map(([label, val, cls]) => (
          <div key={label} className={`rounded-xl p-4 text-center font-semibold ${cls}`}>
            <div className="text-2xl font-bold">{val}</div>
            <div className="text-xs mt-0.5 opacity-80">{label}</div>
          </div>
        ))}
      </div>

      <Alert variant="warn">
        🔑 As Super Admin, you are the platform owner. School admins receive login credentials via email automatically.
      </Alert>

      <Card>
        <SectionHeader title={`Schools (${schools.length})`}>
          <Button variant="primary" size="sm" onClick={openModal}>
            <Plus className="w-3.5 h-3.5" /> Create School
          </Button>
        </SectionHeader>

        {loading ? <Spinner /> : schools.length === 0 ? (
          <EmptyState icon={Building2} title="No schools yet" description="Create your first school to get started." />
        ) : (
          <Table headers={['School', 'Email', 'Region', 'Created', 'Status', 'Actions']}>
            {schools.map(s => (
              <Tr key={s._id}>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-light flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-blue" />
                    </div>
                    <div>
                      <div className="font-semibold">{s.name}</div>
                      {s.district && <div className="text-[11px] text-gray-400">{s.district}</div>}
                    </div>
                  </div>
                </Td>
                <Td className="text-gray-500 text-xs">{s.email}</Td>
                <Td className="text-gray-500">{s.region || '—'}</Td>
                <Td className="text-gray-400 text-xs">{new Date(s.createdAt).toLocaleDateString()}</Td>
                <Td>
                  {s.isActive
                    ? <Badge variant="green"><CheckCircle className="w-3 h-3 inline mr-1" />Active</Badge>
                    : <Badge variant="red"><XCircle className="w-3 h-3 inline mr-1" />Inactive</Badge>
                  }
                </Td>
                <Td>
                  <Button
                    size="sm"
                    variant={s.isActive ? 'danger' : 'success'}
                    onClick={() => toggleSchool(s._id, s.name, s.isActive)}
                  >
                    {s.isActive
                      ? <><ToggleLeft className="w-3.5 h-3.5" /> Deactivate</>
                      : <><ToggleRight className="w-3.5 h-3.5" /> Activate</>
                    }
                  </Button>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Create School Modal */}
      <Modal open={modal} onClose={() => setModal(false)}
        title="Create New School"
        footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create School & Send Credentials'}
          </Button>
        </>}
      >
        <Alert variant="info">
          A school admin account will be automatically created and login credentials sent via email.
        </Alert>

        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 mt-1">School Details</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="School Name *">
              <Input value={form.schoolName} onChange={e => setForm(f => ({ ...f, schoolName: e.target.value }))}
                placeholder="e.g. Accra Basic School" />
            </Field>
          </div>
          <Field label="School Email *">
            <Input type="email" value={form.schoolEmail} onChange={e => setForm(f => ({ ...f, schoolEmail: e.target.value }))}
              placeholder="school@example.com" />
          </Field>
          <Field label="Region">
            <Input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
              placeholder="e.g. Greater Accra" />
          </Field>
          <Field label="District">
            <Input value={form.district} onChange={e => setForm(f => ({ ...f, district: e.target.value }))}
              placeholder="e.g. Accra Metro" />
          </Field>
          <Field label="Circuit">
            <Input value={form.circuit} onChange={e => setForm(f => ({ ...f, circuit: e.target.value }))}
              placeholder="e.g. Osu Circuit" />
          </Field>
        </div>

        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 mt-3">School Admin Account</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Admin Full Name *">
            <Input value={form.adminName} onChange={e => setForm(f => ({ ...f, adminName: e.target.value }))}
              placeholder="e.g. Mr. Kofi Asante" />
          </Field>
          <Field label="Admin Email *">
            <Input type="email" value={form.adminEmail} onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))}
              placeholder="admin@example.com" />
          </Field>
        </div>

        {err && (
          <div className="text-red text-xs bg-red-light border border-red-200 rounded-lg px-3 py-2.5 mt-2">
            {err}
          </div>
        )}
      </Modal>
    </div>
  )
}
