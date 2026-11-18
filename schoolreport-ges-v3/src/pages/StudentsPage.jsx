import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuthStore } from '@/store/authStore'
import { useSchoolStore } from '@/store/schoolStore'
import api, { errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { Card, SectionHeader, Button, Table, Tr, Td, Badge, Modal, Field, Input, Select, Spinner, EmptyState, Avatar, PageHeader } from '@/components/ui'
import { UserPlus, Users, Trash2, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'

export default function StudentsPage() {
  const { user } = useAuthStore()
  const { classes, fetchClasses } = useSchoolStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const isTeacher = user?.role === 'teacher'
  const canDelete = user?.role === 'admin' || user?.role === 'head'

  // Teachers always work in their own class; others can arrive with ?classId= from the Classes page.
  const selectedClass = isTeacher ? (user?.classId || '') : (searchParams.get('classId') || '')
  const setSelectedClass = (id) => setSearchParams(id ? { classId: id } : {}, { replace: true })

  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modal, setModal] = useState(false)
  const [editStudent, setEditStudent] = useState(null)
  const [form, setForm] = useState({ fullName: '', gender: 'M', dateOfBirth: '', classId: '' })

  useEffect(() => { fetchClasses() }, [])

  useEffect(() => {
    if (!selectedClass) { setStudents([]); return }
    setLoading(true)
    api.get('/students', { params: { classId: selectedClass } })
      .then(r => setStudents(r.data))
      .catch((err) => toast.error(errorMessage(err, 'Failed to load students')))
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
    if (!isTeacher && !form.classId) return toast.error('Please choose a class')
    const payload = { ...form, fullName: form.fullName.trim() }
    if (isTeacher) delete payload.classId // the server always uses the teacher's own class
    setSaving(true)
    try {
      if (editStudent) {
        const { data } = await api.put(`/students/${editStudent._id}`, payload)
        // Moved to another class → it no longer belongs in this list.
        setStudents(ss => data.classId === selectedClass
          ? ss.map(s => s._id === data._id ? data : s)
          : ss.filter(s => s._id !== data._id))
        toast.success('Student updated')
      } else {
        const { data } = await api.post('/students', payload)
        if (data.classId === selectedClass) {
          setStudents(ss => [...ss, data].sort((a, b) => a.fullName.localeCompare(b.fullName)))
        }
        toast.success('Student added')
      }
      setModal(false)
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save student'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (s) => {
    if (!confirm(`Remove ${s.fullName}? Their saved scores are kept.`)) return
    try {
      await api.delete(`/students/${s._id}`)
      setStudents(ss => ss.filter(x => x._id !== s._id))
      toast.success('Student removed')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to remove'))
    }
  }

  if (isTeacher && !user?.classId) {
    return (
      <div>
        <PageHeader title="Students" subtitle="Manage student roster by class" />
        <Card>
          <EmptyState icon={Users} title="No class assigned" description="Ask your school admin to assign you a class." />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Students" subtitle="Manage student roster by class" />

      <Card>
        <SectionHeader title={`Students (${students.length})`}>
          {!isTeacher && (
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

        {!selectedClass ? (
          <EmptyState icon={Users} title="No class selected" description="Select a class above to see its students." />
        ) : loading ? <Spinner /> : students.length === 0 ? (
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
                  {s.dateOfBirth ? formatDate(s.dateOfBirth) : '—'}
                </Td>
                <Td>
                  <div className="flex gap-1.5 justify-end">
                    <Button size="sm" onClick={() => openEdit(s)} title="Edit"><Pencil className="w-3 h-3" /></Button>
                    {canDelete && (
                      <Button size="sm" variant="danger" onClick={() => remove(s)} title="Remove"><Trash2 className="w-3 h-3" /></Button>
                    )}
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
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Student'}</Button>
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
          {!isTeacher && (
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
