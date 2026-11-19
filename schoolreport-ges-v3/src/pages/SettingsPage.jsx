import { useEffect, useRef, useState } from 'react'
import { useSchoolStore } from '@/store/schoolStore'
import { useAuthStore } from '@/store/authStore'
import api, { errorMessage } from '@/lib/api'
import { prepareLogo, LOGO_ACCEPT } from '@/lib/logo'
import GradingEditor from '@/components/settings/GradingEditor'
import { Card, SectionHeader, Button, Field, Input, Select, Table, Tr, Td, Modal, Spinner, Alert, PageHeader } from '@/components/ui'
import { Save, Plus, Trash2, BookOpen, GraduationCap, Settings, ImagePlus, Building2 } from 'lucide-react'

/** Upload / change / remove the school logo (shown on reports and in the app). */
function LogoEditor() {
  const { logoUrl, loadLogo, settings } = useSchoolStore()
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)

  const choose = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be picked again
    if (!file) return
    setBusy(true)
    try {
      const png = await prepareLogo(file)
      const { data } = await api.put('/school/logo', png, { headers: { 'Content-Type': 'image/png' } })
      await loadLogo(data.logoVersion)
      toast.success('Logo saved — it now appears on reports.')
    } catch (err) {
      toast.error(err.response ? errorMessage(err, 'Failed to save the logo') : err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('Remove the school logo from reports and the app?')) return
    setBusy(true)
    try {
      await api.delete('/school/logo')
      await loadLogo(null)
      toast.success('Logo removed')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to remove the logo'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4 mb-4 p-3 rounded-xl bg-[#f8faff] border border-border">
      <div className="w-20 h-20 rounded-xl bg-white border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
        {logoUrl
          ? <img src={logoUrl} alt={`${settings?.schoolName || 'School'} logo`} className="max-w-full max-h-full object-contain" />
          : <Building2 className="w-8 h-8 text-gray-300" />}
      </div>
      <div className="flex-1 min-w-[180px]">
        <div className="text-sm font-semibold text-gray-800">School logo</div>
        <div className="text-xs text-gray-400 mt-0.5">
          Shown on printed reports and in the app. PNG, JPEG, WebP or SVG; a square logo looks best.
        </div>
        <div className="flex gap-2 mt-2">
          <input ref={fileRef} type="file" accept={LOGO_ACCEPT} className="hidden" onChange={choose} />
          <Button size="sm" variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <ImagePlus className="w-3.5 h-3.5" />
            {busy ? 'Saving…' : logoUrl ? 'Change logo' : 'Upload logo'}
          </Button>
          {logoUrl && (
            <Button size="sm" variant="danger" onClick={remove} disabled={busy}>
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const { settings, subjects, classes, fetchSettings, fetchSubjects, fetchClasses } = useSchoolStore()
  const { user } = useAuthStore()
  const canManageClasses = user?.role === 'admin' // the server allows only admins to change classes
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
    } catch (err) { toast.error(errorMessage(err, 'Failed to save settings')) }
    finally { setSavingSchool(false) }
  }

  const saveMaxMarks = async () => {
    try {
      const { data } = await api.put('/school/max-marks', maxMarks)
      setMaxMarks(data)
      toast.success('Max marks saved!')
      setMarksModal(false)
    } catch (err) { toast.error(errorMessage(err, 'Failed to save')) }
  }

  const saveSub = async () => {
    if (!subForm.name.trim()) return toast.error('Subject name required')
    try {
      editSub ? await api.put(`/school/subjects/${editSub._id}`, subForm) : await api.post('/school/subjects', subForm)
      await fetchSubjects()
      setSubModal(false)
      toast.success(editSub ? 'Subject updated' : 'Subject added')
    } catch (err) { toast.error(errorMessage(err, 'Failed to save subject')) }
  }

  const deleteSub = async (sub) => {
    if (!confirm(`Delete "${sub.name}"? All scores entered for this subject are deleted too.`)) return
    try {
      await api.delete(`/school/subjects/${sub._id}`)
      await fetchSubjects()
      toast.success('Subject deleted')
    } catch (err) { toast.error(errorMessage(err, 'Failed to delete subject')) }
  }

  const saveCls = async () => {
    if (!clsForm.name.trim()) return toast.error('Class name required')
    try {
      editCls ? await api.put(`/school/classes/${editCls._id}`, clsForm) : await api.post('/school/classes', clsForm)
      await fetchClasses()
      setClsModal(false)
      toast.success(editCls ? 'Class updated' : 'Class added')
    } catch (err) { toast.error(errorMessage(err, 'Failed to save class')) }
  }

  const deleteCls = async (cls) => {
    if (!confirm(`Delete "${cls.name}"?`)) return
    try {
      await api.delete(`/school/classes/${cls._id}`)
      await fetchClasses()
      toast.success('Class deleted')
    } catch (err) { toast.error(errorMessage(err, 'Failed to delete class')) }
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
        <LogoEditor />
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

      <GradingEditor settings={settings} onSaved={fetchSettings} />

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
                  <Button size="sm" variant="danger" onClick={() => deleteSub(sub)}>
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
          {canManageClasses && (
            <Button size="sm" variant="primary" onClick={() => { setEditCls(null); setClsForm({ name: '', level: '' }); setClsModal(true) }}>
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add Class</span>
              <span className="sm:hidden">Add</span>
            </Button>
          )}
        </SectionHeader>
        <Table headers={['Class Name', 'Level', 'Students', '']}>
          {classes.map(cls => (
            <Tr key={cls._id}>
              <Td className="font-medium text-sm">{cls.name}</Td>
              <Td className="text-gray-400 text-sm">{cls.level || '—'}</Td>
              <Td className="text-gray-500 text-sm">{cls.studentCount ?? 0}</Td>
              <Td>
                {canManageClasses && (
                  <div className="flex gap-1.5 justify-end">
                    <Button size="sm" title="Edit class" onClick={() => { setEditCls(cls); setClsForm({ name: cls.name, level: cls.level || '' }); setClsModal(true) }}>
                      <GraduationCap className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="danger" title="Delete class" onClick={() => deleteCls(cls)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>

      {/* Max Marks Modal */}
      <Modal open={marksModal} onClose={() => setMarksModal(false)} title="Max Class Score Per Subject"
        footer={<><Button onClick={() => setMarksModal(false)}>Cancel</Button><Button variant="primary" onClick={saveMaxMarks}>Save</Button></>}>
        <Alert variant="info">Enter the raw mark each subject's class score is out of. It is converted to the class-score share set under Grading ({settings?.classScoreWeight ?? 40}%).</Alert>
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
