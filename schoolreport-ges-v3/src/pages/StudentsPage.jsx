import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useSchoolStore } from '@/store/schoolStore'
import api from '@/lib/api'
import { Card, SectionHeader, Button, Table, Tr, Td, Badge, Modal, Field, Input, Select, Spinner, EmptyState, Avatar, PageHeader } from '@/components/ui'
import { UserPlus, Users, Trash2, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'

export default function StudentsPage() {
  const { user } = useAuthStore()
  const { classes, fetchClasses } = useSchoolStore()
  const [students, setStudents] = useState([])
  const [selectedClass, setSelectedClass] = useState('')
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [editStudent, setEditStudent] = useState(null)
  const [form, setForm] = useState({ fullName: '', gender: 'M', dateOfBirth: '', classId: '' })

  useEffect(() => { fetchClasses() }, [])

  useEffect(() => {
    if (user?.role === 'teacher' && user.classId) setSelectedClass(user.classId)
  }, [user])

  useEffect(() => {
    if (!selectedClass) return
    setLoading(true)
    api.get(`/students?classId=${selectedClass}`)
      .then(r => setStudents(r.data))
      .catch(() => toast.error('Failed to load students'))
      .finally(() => setLoading(false))
  }, [selectedClass])

  const openAdd = () => {
    setEditStudent(null)
    setForm({ fullName: '', gender: 'M', dateOfBirth: '', classId: selectedClass })
    setModal(true)
  }

  const openEdit = (s) => {
    setEditStudent(s)
    setForm({ fullName: s.fullName, gender: s.gender, dateOfBirth: s.dateOfBirth?.slice(0, 10) || '', classId: s.classId })
    setModal(true)
  }

  const save = async () => {
    if (!form.fullName.trim()) return toast.error('Name is required')
    try {
      if (editStudent) {
        const { data } = await api.put(`/students/${editStudent._id}`, form)
        setStudents(ss => ss.map(s => s._id === data._id ? data : s))
        toast.success('Student updated')
      } else {
        const { data } = await api.post('/students', { ...form, classId: selectedClass })
        setStudents(ss => [...ss, data])
        toast.success('Student added')
      }
      setModal(false)
    } catch { toast.error('Failed to save student') }
  }

  const remove = async (id) => {
    if (!confirm('Remove this student?')) return
    try {
      await api.delete(`/students/${id}`)
      setStudents(ss => ss.filter(s => s._id !== id))
      toast.success('Student removed')
    } catch { toast.error('Failed to remove') }
  }

  return (
    <div>
      <PageHeader title="Students" subtitle="Manage student roster by class" />

      <Card>
        <SectionHeader title={`Students (${students.length})`}>
          {user?.role !== 'teacher' && (
            <Select className="w-40 sm:w-44" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
              <option value="">Select class…</option>
              {classes.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
          )}
          <Button variant="primary" size="sm" onClick={openAdd} disabled={!selectedClass}>
            <UserPlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Add Student</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </SectionHeader>

        {loading ? <Spinner /> : students.length === 0 ? (
          <EmptyState icon={Users} title="No students yet" description="Add students to this class to get started." />
        ) : (
          <Table headers={['#', 'Name', 'Gender', 'DOB', '']}>
            {students.map((s, i) => (
              <Tr key={s._id}>
                <Td className="text-gray-400 w-8 text-xs">{i + 1}</Td>
                <Td>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={s.fullName} />
                    <span className="font-medium text-sm">{s.fullName}</span>
                  </div>
                </Td>
                <Td>
                  <Badge variant={s.gender === 'M' ? 'blue' : 'amber'}>
                    {s.gender === 'M' ? 'Male' : 'Female'}
                  </Badge>
                </Td>
                <Td className="text-gray-400 text-xs hidden sm:table-cell">
                  {s.dateOfBirth ? new Date(s.dateOfBirth).toLocaleDateString() : '—'}
                </Td>
                <Td>
                  <div className="flex gap-1.5 justify-end">
                    <Button size="sm" onClick={() => openEdit(s)}><Pencil className="w-3 h-3" /></Button>
                    <Button size="sm" variant="danger" onClick={() => remove(s._id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)}
        title={editStudent ? 'Edit Student' : 'Add Student'}
        footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save Student</Button>
        </>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
          <div className="sm:col-span-2">
            <Field label="Full Name">
              <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} placeholder="e.g. Kwame Mensah" />
            </Field>
          </div>
          <Field label="Gender">
            <Select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </Select>
          </Field>
          <Field label="Date of Birth">
            <Input type="date" value={form.dateOfBirth} onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
          </Field>
          {user?.role !== 'teacher' && (
            <div className="sm:col-span-2">
              <Field label="Class">
                <Select value={form.classId} onChange={e => setForm(f => ({ ...f, classId: e.target.value }))}>
                  <option value="">Select…</option>
                  {classes.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                </Select>
              </Field>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
