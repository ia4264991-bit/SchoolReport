import { useRef, useState } from 'react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import api, { errorMessage } from '@/lib/api'
import { readRows, toPupils, templateCsv } from '@/lib/importPupils'
import { Modal, Button, Select, Field, Badge, Alert } from '@/components/ui'
import { FileSpreadsheet, Download } from 'lucide-react'

const CHUNK = 500

/**
 * Upload a class list from Excel or CSV: preview with problems marked, then add the good
 * rows in one go. Pupils already on the roll (same name, same class) are skipped.
 */
export default function ImportPupils({ open, onClose, classes, defaultClassId, onDone }) {
  const fileRef = useRef(null)
  const [classId, setClassId] = useState(defaultClassId || '')
  const [parsed, setParsed] = useState(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => { setParsed(null); setFileName('') }
  const close = () => { reset(); onClose() }

  const choose = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const rows = await readRows(file)
      // Who is already on the roll, to skip them.
      const { data: all } = await api.get('/students')
      const existing = new Set(all.map((s) => `${s.classId}|${s.fullName.trim().toLowerCase()}`))
      const result = toPupils(rows, { classes, defaultClassId: classId, existing })
      if (!result.pupils.length) throw new Error('No pupils found under the headings.')
      setParsed(result)
      setFileName(file.name)
    } catch (err) {
      toast.error(err.message || 'Could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  const good = parsed ? parsed.pupils.filter((p) => !p.error && !p.duplicate) : []
  const bad = parsed ? parsed.pupils.filter((p) => p.error) : []
  const dups = parsed ? parsed.pupils.filter((p) => !p.error && p.duplicate) : []

  const importNow = async () => {
    setBusy(true)
    let added = 0
    try {
      for (let i = 0; i < good.length; i += CHUNK) {
        const { data } = await api.post('/students/bulk', { students: good.slice(i, i + CHUNK).map((p) => p.data) })
        added += data.length
      }
      toast.success(`${added} pupil(s) added.`)
      onDone()
      close()
    } catch (err) {
      toast.error(`${added ? `${added} added, then: ` : ''}${errorMessage(err, 'Import failed')}`, { duration: 8000 })
      if (added) onDone()
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'pupils-template.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal open={open} onClose={close} title="Import pupils from Excel"
      footer={parsed ? <>
        <Button onClick={reset}>Choose another file</Button>
        <Button variant="primary" onClick={importNow} disabled={busy || !good.length}>{busy ? 'Adding…' : `Add ${good.length} pupil(s)`}</Button>
      </> : null}>
      {!parsed ? (
        <div>
          <p className="text-sm text-gray-600 mb-3">
            Use the class list you already have. The first row needs headings — for example <b>Name, Gender, Date of birth, Class, Parent name, Parent phone</b>.
            Excel (.xlsx) or CSV.
          </p>
          <Field label="Class for pupils without a Class column">
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">— the file has a Class column —</option>
              {classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
          </Field>
          <input ref={fileRef} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" onChange={choose} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}><FileSpreadsheet className="w-4 h-4" /> {busy ? 'Reading…' : 'Choose file'}</Button>
            <Button onClick={download}><Download className="w-4 h-4" /> Download a template</Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="text-xs text-gray-500 mb-2">{fileName} · columns found: {parsed.found.join(', ')}</div>
          <div className="flex flex-wrap gap-2 mb-3">
            <Badge variant="green">{good.length} ready</Badge>
            {dups.length > 0 && <Badge variant="gray">{dups.length} already on the roll (skipped)</Badge>}
            {bad.length > 0 && <Badge variant="red">{bad.length} with problems (skipped)</Badge>}
          </div>
          {bad.length > 0 && <Alert variant="warn">Rows with problems are left out. Fix them in the file and import again — pupils already added are skipped automatically.</Alert>}
          <div className="max-h-72 overflow-y-auto border border-border rounded-lg text-xs">
            {parsed.pupils.map((p) => (
              <div key={p.row} className={clsx('flex gap-2 px-3 py-1.5 border-b border-[#f0f4fb] last:border-0', p.error ? 'bg-red-light' : p.duplicate ? 'bg-gray-50 text-gray-400' : '')}>
                <span className="w-8 text-gray-400">#{p.row}</span>
                <span className="flex-1 font-medium">{p.data.fullName}</span>
                <span className="w-6">{p.data.gender}</span>
                <span className="w-24 truncate">{classes.find((c) => c._id === p.data.classId)?.name || ''}</span>
                <span className="flex-1 truncate">{p.error || (p.duplicate ? 'already on the roll' : p.data.guardianPhone)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
