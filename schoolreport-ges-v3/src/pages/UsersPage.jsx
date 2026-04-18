import { useEffect, useState } from 'react'
import { useSchoolStore } from '@/store/schoolStore'
import { useAuthStore } from '@/store/authStore'
import api from '@/lib/api'
import { Card, SectionHeader, Button, Table, Tr, Td, Badge, Modal, Field, Input, Select, Textarea, Avatar, Spinner, EmptyState, Alert } from '@/components/ui'
import { UserPlus, Users, Trash2, Pencil, RotateCcw, Lock } from 'lucide-react'
import toast from 'react-hot-toast'

const ROLE_COLORS = { admin: 'blue', head: 'green', teacher: 'amber', student: 'gray' }
const ROLE_LABELS = { admin: 'Admin', head: 'Head Teacher', teacher: 'Class Teacher', student: 'Student' }

export default function UsersPage() {
  const { classes, fetchClasses, settings } = useSchoolStore()
  const { user: currentUser } = useAuthStore()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [form, setForm] = useState({ fullName: '', email: '', role: 'teacher', classId: '', notes: '' })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchClasses()
    api.get('/users')
      .then(r => setUsers(r.data))
      .catch(() => toast.error('Failed to load users'))
      .finally(() => setLoading(false))
  }, [])

  const openAdd = () => {
    setEditUser(null)
    setForm({ fullName: '', email: '', role: 'teacher', classId: '', notes: '' })
    setErr('')
    setModal(true)
  }

  const openEdit = (u) => {
    setEditUser(u)
    setForm({ fullName: u.fullName, email: u.email, role: u.role, classId: u.classId || '', notes: u.notes || '' })
    setErr('')
    setModal(true)
  }

  const validate = () => {
    if (!form.fullName.trim()) return 'Full name is required.'
    if (!editUser && !form.email.trim()) return 'Email is required.'
    if (!editUser && !/\S+@\S+\.\S+/.test(form.email)) return 'Enter a valid email address.'
    if (form.role === 'teacher' && !form.classId) return 'Please assign a class to this teacher.'
    return ''
  }

  const save = async () => {
    const error = validate()
    if (error) return setErr(error)
    setSaving(true)
    try {
      const payload = {
        ...form,
        schoolName: settings?.schoolName || 'Your School',
      }
      if (editUser) {
        const { data } = await api.put(`/users/${editUser._id}`, payload)
        setUsers(us => us.map(u => u._id === data._id ? data : u))
        toast.success('User updated')
      } else {
        const { data } = await api.post('/users', payload)
        setUsers(us => [...us, data.user])
        toast.success('User created. Credentials sent via email.')
      }
      setModal(false)
    } catch (e) {
      setErr(e.response?.data?.message || 'Failed to save user.')
    } finally { setSaving(false) }
  }

  const remove = async (id) => {
    if (!confirm('Deactivate this user? They will no longer be able to log in.')) return
    try {
      await api.delete(`/users/${id}`)
      setUsers(us => us.map(u => u._id === id ? { ...u, isActive: false } : u))
      toast.success('User deactivated')
    } catch { toast.error('Failed to deactivate user') }
  }

  const resetPassword = async (u) => {
    if (!confirm(`Reset password for ${u.fullName}? A new temporary password will be emailed to them.`)) return
    try {
      await api.post(`/users/${u._id}/reset-password`, { schoolName: settings?.schoolName || 'Your School' })
      toast.success(`New credentials sent to ${u.email}`)
    } catch { toast.error('Failed to reset password') }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">User Management</h1>
        <p className="text-sm text-gray-400">Manage staff accounts — passwords are auto-generated and emailed</p>
      </div>

      <Alert variant="info">
        🔒 Passwords are auto-generated and sent to the user's email. Users must change their password on first login.
      </Alert>

      <Card>
        <SectionHeader title={`Users (${users.length})`}>
          <Button variant="primary" size="sm" onClick={openAdd}>
            <UserPlus className="w-3.5 h-3.5" /> Add User
          </Button>
        </SectionHeader>

        {loading ? <Spinner /> : users.length === 0 ? (
          <EmptyState icon={Users} title="No users found" description="Add the first staff member to get started." />
        ) : (
          <Table headers={['User', 'Email', 'Role', 'Class', 'Status', 'Actions']}>
            {users.map(u => (
              <Tr key={u._id}>
                <Td>
                  <div className="flex items-center gap-2">
                    <Avatar name={u.fullName} color={ROLE_COLORS[u.role]} />
                    <div>
                      <div className="font-medium">{u.fullName}</div>
                      {u.mustChangePassword && (
                        <span className="text-[10px] text-amber bg-amber-light px-1.5 py-0.5 rounded font-semibold">
                          Must change password
                        </span>
                      )}
                    </div>
                  </div>
                </Td>
                <Td className="text-gray-500 text-xs">{u.email}</Td>
                <Td><Badge variant={ROLE_COLORS[u.role]}>{ROLE_LABELS[u.role]}</Badge></Td>
                <Td className="text-gray-500 text-xs">
                  {u.role === 'teacher' ? (classes.find(c => c._id === u.classId)?.name || '—') : '—'}
                </Td>
                <Td>
                  <Badge variant={u.isActive ? 'green' : 'red'}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex gap-1.5">
                    <Button size="sm" onClick={() => openEdit(u)} title="Edit">
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="warn" onClick={() => resetPassword(u)} title="Reset password">
                      <RotateCcw className="w-3 h-3" />
                    </Button>
                    {u._id !== currentUser?._id && (
                      <Button size="sm" variant="danger" onClick={() => remove(u._id)} title="Deactivate">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)}
        title={editUser ? 'Edit User' : 'Add New User'}
        footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editUser ? 'Save Changes' : 'Create & Send Credentials'}
          </Button>
        </>}
      >
        {!editUser && (
          <Alert variant="info">
            A secure temporary password will be auto-generated and sent to the user's email address.
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full Name">
            <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
              placeholder="e.g. Mrs. Ama Mensah" />
          </Field>
          <Field label="Email Address">
            <Input type="email" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="user@example.com"
              disabled={!!editUser}
              className={editUser ? 'bg-gray-50 text-gray-400' : ''}
            />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="admin">Admin</option>
              <option value="head">Head Teacher</option>
              <option value="teacher">Class Teacher</option>
              <option value="student">Student</option>
            </Select>
          </Field>
          {(form.role === 'teacher' || form.role === 'student') && (
            <Field label="Assigned Class">
              <Select value={form.classId} onChange={e => setForm(f => ({ ...f, classId: e.target.value }))}>
                <option value="">Select class…</option>
                {classes.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          <div className="col-span-2">
            <Field label="Notes (optional)">
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any additional notes…" />
            </Field>
          </div>
        </div>
        {err && (
          <div className="flex items-center gap-2 mt-2 text-red text-xs bg-red-light border border-red-200 rounded-lg px-3 py-2">
            <Lock className="w-3.5 h-3.5 flex-shrink-0" /> {err}
          </div>
        )}
      </Modal>
    </div>
  )
}

