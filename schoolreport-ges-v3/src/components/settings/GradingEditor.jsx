import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import api, { errorMessage } from '@/lib/api'
import { PRESET_LABELS } from '@/lib/grading'
import { Card, SectionHeader, Button, Select, Input, Field, Alert } from '@/components/ui'
import { Save, Plus, Trash2 } from 'lucide-react'

/** The school's grading scale and class-score / exam split. */
export default function GradingEditor({ settings, onSaved }) {
  const [presets, setPresets] = useState(null)
  const [preset, setPreset] = useState('nacca')
  const [bands, setBands] = useState([])
  const [weight, setWeight] = useState(40)
  const [saving, setSaving] = useState(false)

  useEffect(() => { api.get('/school/grading-presets').then((r) => setPresets(r.data)).catch(() => {}) }, [])
  useEffect(() => {
    if (!settings?.gradingScale) return
    setPreset(settings.gradingScale.preset || 'custom')
    setBands(settings.gradingScale.bands.map((b) => ({ ...b, min: String(b.min) })))
    setWeight(settings.classScoreWeight ?? 40)
  }, [settings])

  const choosePreset = (p) => {
    setPreset(p)
    if (presets?.[p]) setBands(presets[p].map((b) => ({ ...b, min: String(b.min) })))
  }
  const edit = (i, k, v) => { setPreset('custom'); setBands((bs) => bs.map((b, j) => (j === i ? { ...b, [k]: v } : b))) }

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/school/settings', {
        gradingScale: { preset, bands: bands.map((b) => ({ ...b, min: Number(b.min) })) },
        classScoreWeight: Number(weight),
      })
      toast.success('Grading saved. Every report now uses it.')
      onSaved()
    } catch (e) { toast.error(errorMessage(e, 'Could not save the grading')) } finally { setSaving(false) }
  }

  return (
    <Card>
      <SectionHeader title="📊 Grading">
        <Button variant="success" size="sm" onClick={save} disabled={saving}><Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}</Button>
      </SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Scale">
          <Select value={preset} onChange={(e) => choosePreset(e.target.value)}>
            {Object.entries(PRESET_LABELS).map(([k, l]) => <option key={k} value={k} disabled={k === 'custom'}>{l}</option>)}
          </Select>
        </Field>
        <Field label={`Class score share: ${weight}% · exam ${100 - Number(weight || 0)}%`}>
          <Input type="number" min="0" max="100" step="5" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
      </div>
      <div className="border border-border rounded-xl overflow-hidden mb-3">
        <div className="grid grid-cols-[90px_80px_1fr_36px] gap-2 px-3 py-2 bg-[#f0f4fb] text-[11px] font-bold text-gray-500 uppercase">
          <span>From %</span><span>Grade</span><span>Remark</span><span />
        </div>
        {bands.map((b, i) => (
          <div key={i} className="grid grid-cols-[90px_80px_1fr_36px] gap-2 px-3 py-1.5 border-t border-[#f0f4fb] items-center">
            <Input type="number" min="0" max="100" value={b.min} disabled={i === bands.length - 1} onChange={(e) => edit(i, 'min', e.target.value)} aria-label="From" />
            <Input value={b.grade} maxLength={6} onChange={(e) => edit(i, 'grade', e.target.value)} aria-label="Grade" />
            <Input value={b.remark} maxLength={40} onChange={(e) => edit(i, 'remark', e.target.value)} aria-label="Remark" />
            <button onClick={() => { setPreset('custom'); setBands((bs) => bs.filter((_, j) => j !== i)) }} disabled={bands.length <= 2 || i === bands.length - 1}
              className="p-1.5 text-gray-300 hover:text-red disabled:opacity-20" aria-label="Remove band"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => { setPreset('custom'); setBands((bs) => [...bs.slice(0, -1), { min: '', grade: '', remark: '' }, bs[bs.length - 1]]) }} disabled={bands.length >= 12}>
          <Plus className="w-3.5 h-3.5" /> Add band
        </Button>
        <span className="text-xs text-gray-400">Highest band first; the last band always starts at 0.</span>
      </div>
      <Alert variant="info">Changing the scale or the class-score share recalculates every report, including past terms.</Alert>
    </Card>
  )
}
