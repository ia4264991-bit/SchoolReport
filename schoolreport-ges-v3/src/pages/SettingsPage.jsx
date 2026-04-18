import { useEffect, useState } from 'react'
import { useSchoolStore } from '@/store/schoolStore'
import api from '@/lib/api'
import { Card, SectionHeader, Button, Field, Input, Select, Table, Tr, Td, Modal, Spinner, Alert, PageHeader } from '@/components/ui'
import { Save, Plus, Trash2, BookOpen, GraduationCap, Settings } from 'lucide-react'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const { settings, subjects, classes, fetchSettings, fetchSubjects, fetchClasses } = useSchoolStore()
  const [schoolForm, setSchoolForm] = useState({})
  const [savingSchool, setSavingSchool] = useState(false)
  const [marksModal, setMarksModal] = useState(false)
  const [maxMarks, setMaxMarks] = useState({})
  const [subModal, setSubModal] = useState(false)
  const [subForm, setSubForm] = useState({ name: '', code: '' })
  const [editSub, setEditSub] = useState(null)
  const [clsModal, setClsModal] = useState(false)
  const [clsForm, setClsForm] = useState({ name: '', level: '' })
  const [editCls, setEditCls] = useState(null)

  useEffect(() => {
    fetchSettings(); fetchSubjects(); fetchClasses()
    api.get('/school/max-marks').then(r => setMaxMarks(r.data)).catch(() => {})
  }, [])

  useEffect(() => { if (settings) setSchoolForm(settings) }, [settings])

  const saveSchool = async () => {
    setSavingSchool(true)
    try {
      await api.put('/school/settings', schoolForm)
      await fetchSettings()
      toast.success('School settings saved!')
    } catch { toast.error('Failed to save settings') }
    finally { setSavingSchool(false) }
  }

  const saveMaxMarks = async () => {
    try {
      await api.put('/school/max-marks', maxMarks)
      toast.success('Max marks saved!')
      setMarksModal(false)
    } catch { toast.error('Failed to save') }
  }

  const saveSub = async () => {
    if (!subForm.name.trim()) return toast.error('Subject name required')
    try {
      editSub ? await api.put(`/school/subjects/${editSub._id}`, subForm) : await api.post('/school/subjects', subForm)
      await fetchSubjects()
      setSubModal(false)
      toast.success(editSub ? 'Subject updated' : 'Subject added')
    } catch { toast.error('Failed to save subject') }
  }

  const deleteSub = async (id) => {
    if (!confirm('Delete this subject?')) return
    await api.delete(`/school/subjects/${id}`)
    await fetchSubjects()
    toast.success('Subject deleted')
  }

  const saveCls = async () => {
    if (!clsForm.name.trim()) return toast.error('Class name required')
    try {
      editCls ? await api.put(`/school/classes/${editCls._id}`, clsForm) : await api.post('/school/classes', clsForm)
      await fetchClasses()
      setClsModal(false)
      toast.success(editCls ? 'Class updated' : 'Class added')
    } catch { toast.error('Failed to save class') }
  }

  const deleteCls = async (id) => {
    if (!confirm('Delete this class?')) return
    await api.delete(`/school/classes/${id}`)
    await fetchClasses()
    toast.success('Class deleted')
  }

  const schoolFields = [
    ['schoolName', 'School Name', 'e.g. Accra Basic School'],
    ['circuit',    'Circuit',     'e.g. Osu Circuit'],
    ['district',   'District',   'e.g. Accra Metro'],
    ['region',     'Region',     'e.g. Greater Accra'],
    ['headTeacher','Head Teacher','e.g. Mr. Kofi Asante'],
    ['academicYear','Academic Year','e.g. 2024/2025'],
  ]

  return (
    <div>
      <PageHeader title="Settings" subtitle="Configure school information, classes and subjects" />

      {/* School Info */}
      <Card>
        <SectionHeader title="🏫 School Information">
          <Button variant="success" size="sm" onClick={saveSchool} disabled={savingSchool}>
            <Save className="w-3.5 h-3.5" />
            {savingSchool ? 'Saving…' : 'Save'}
          </Button>
        </SectionHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          {schoolFields.map(([key, label, placeholder]) => (
            <Field key={key} label={label}>
              <Input value={schoolForm[key] || ''} onChange={e => setSchoolForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} />
            </Field>
          ))}
          <Field label="Current Term">
            <Select value={schoolForm.term || '1'} onChange={e => setSchoolForm(f => ({ ...f, term: e.target.value }))}>
              <option value="1">Term 1</option>
              <option value="2">Term 2</option>
              <option value="3">Term 3</option>
            </Select>
          </Field>
          <Field label="Next Term Begins">
            <Input type="date" value={schoolForm.nextTermDate || ''} onChange={e => setSchoolForm(f => ({ ...f, nextTermDate: e.target.value }))} />
          </Field>
        </div>
      </Card>

      {/* Subjects */}
      <Card>
        <SectionHeader title="📚 Subjects">
          <Button size="sm" variant="warn" onClick={() => setMarksModal(true)}>
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Set Max Marks</span>
            <span className="sm:hidden">Marks</span>
          </Button>
          <Button size="sm" variant="primary" onClick={() => { setEditSub(null); setSubForm({ name: '', code: '' }); setSubModal(true) }}>
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Add Subject</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </SectionHeader>
        <Table headers={['Subject', 'Code', 'Max CS', '']}>
          {subjects.map(sub => (
            <Tr key={sub._id}>
              <Td className="font-medium text-sm">{sub.name}</Td>
              <Td className="text-gray-400 font-mono text-xs hidden sm:table-cell">{sub.code || '—'}</Td>
              <Td><span className="font-bold text-blue text-sm">{maxMarks[sub._id] || '100'}</span></Td>
              <Td>
                <div className="flex gap-1.5 justify-end">
                  <Button size="sm" onClick={() => { setEditSub(sub); setSubForm({ name: sub.name, code: sub.code || '' }); setSubModal(true) }}>
                    <BookOpen className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => deleteSub(sub._id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>

      {/* Classes */}
      <Card>
        <SectionHeader title="🏫 Classes">
          <Button size="sm" variant="primary" onClick={() => { setEditCls(null); setClsForm({ name: '', level: '' }); setClsModal(true) }}>
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Add Class</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </SectionHeader>
        <Table headers={['Class Name', 'Level', '']}>
          {classes.map(cls => (
            <Tr key={cls._id}>
              <Td className="font-medium text-sm">{cls.name}</Td>
              <Td className="text-gray-400 text-sm">{cls.level || '—'}</Td>
              <Td>
                <div className="flex gap-1.5 justify-end">
                  <Button size="sm" onClick={() => { setEditCls(cls); setClsForm({ name: cls.name, level: cls.level || '' }); setClsModal(true) }}>
                    <GraduationCap className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => deleteCls(cls._id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>

      {/* Max Marks Modal */}
      <Modal open={marksModal} onClose={() => setMarksModal(false)} title="Max Class Score Per Subject"
        footer={<><Button onClick={() => setMarksModal(false)}>Cancel</Button><Button variant="primary" onClick={saveMaxMarks}>Save</Button></>}>
        <Alert variant="info">Enter the max raw mark for Class Score per subject. System converts it to 40%.</Alert>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
          {subjects.map(sub => (
            <Field key={sub._id} label={sub.name}>
              <Input type="number" min="1" value={maxMarks[sub._id] || ''}
                onChange={e => setMaxMarks(m => ({ ...m, [sub._id]: e.target.value }))} placeholder="e.g. 30" />
            </Field>
          ))}
        </div>
      </Modal>

      {/* Subject Modal */}
      <Modal open={subModal} onClose={() => setSubModal(false)} title={editSub ? 'Edit Subject' : 'Add Subject'}
        footer={<><Button onClick={() => setSubModal(false)}>Cancel</Button><Button variant="primary" onClick={saveSub}>Save</Button></>}>
        <Field label="Subject Name">
          <Input value={subForm.name} onChange={e => setSubForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Mathematics" />
        </Field>
        <Field label="Code (optional)">
          <Input value={subForm.code} onChange={e => setSubForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. MATH" />
        </Field>
      </Modal>

      {/* Class Modal */}
      <Modal open={clsModal} onClose={() => setClsModal(false)} title={editCls ? 'Edit Class' : 'Add Class'}
        footer={<><Button onClick={() => setClsModal(false)}>Cancel</Button><Button variant="primary" onClick={saveCls}>Save</Button></>}>
        <Field label="Class Name">
          <Input value={clsForm.name} onChange={e => setClsForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Class 4A" />
        </Field>
        <Field label="Level (optional)">
          <Input value={clsForm.level} onChange={e => setClsForm(f => ({ ...f, level: e.target.value }))} placeholder="e.g. Primary 4" />
        </Field>
      </Modal>
    </div>
  )
}
