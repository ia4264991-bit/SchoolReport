import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuthStore } from '@/store/authStore'
import api from '@/lib/api'
import { Shield, AlertCircle, CheckCircle2 } from 'lucide-react'

const REGIONS = ['Ahafo', 'Ashanti', 'Bono', 'Bono East', 'Central', 'Eastern', 'Greater Accra', 'North East', 'Northern',
  'Oti', 'Savannah', 'Upper East', 'Upper West', 'Volta', 'Western', 'Western North']
const inputCls = 'w-full px-4 py-3 border border-[#d0d7e8] rounded-xl text-sm focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-light transition-all placeholder:text-gray-300'

function F({ label, children }) {
  return <div className="mb-3"><label className="block text-xs font-semibold text-gray-500 mb-1.5">{label}</label>{children}</div>
}

/** A school signs itself up: details → email code → signed in, on a free trial. */
export default function SignupPage() {
  const navigate = useNavigate()
  const { setSession } = useAuthStore()
  const [step, setStep] = useState('details')
  const [form, setForm] = useState({ schoolName: '', region: '', district: '', adminName: '', email: '', phone: '', password: '', setupDefaults: true, acceptTerms: false })
  const [code, setCode] = useState('')
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })); setError('') }
  const fail = (err, fallback) => setError(err.response?.data?.message || (err.response ? fallback : 'Cannot reach the server. Check your connection.'))

  const start = async (e) => {
    e.preventDefault()
    if (!form.acceptTerms) return setError('Please accept the Terms and the Privacy Policy.')
    setBusy(true)
    try {
      const { data } = await api.post('/signup/start', form)
      setInfo(data.message)
      setStep('code')
    } catch (err) { fail(err, 'Could not start the sign-up.') } finally { setBusy(false) }
  }
  const verify = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const { data } = await api.post('/signup/verify', { email: form.email, code })
      setSession(data.token, data.user)
      navigate('/dashboard?welcome=1')
    } catch (err) { fail(err, 'Wrong or expired code.') } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-10" style={{ background: 'linear-gradient(135deg, #e8f0fb 0%, #f0f4ff 100%)' }}>
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl border border-[#dde3f0] overflow-hidden">
        <div className="bg-blue px-8 py-6 text-center">
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-2"><Shield className="w-7 h-7 text-white" /></div>
          <h1 className="text-xl font-bold text-white">Start your free trial</h1>
          <p className="text-blue-light text-xs mt-1 opacity-90">Reports, attendance, fees and parents — for Ghanaian basic schools</p>
        </div>
        <div className="px-6 py-6">
          {step === 'details' ? (
            <form onSubmit={start} noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
                <div className="sm:col-span-2"><F label="School name"><input className={inputCls} value={form.schoolName} onChange={set('schoolName')} placeholder="e.g. Sunrise Academy" /></F></div>
                <F label="Region"><select className={inputCls} value={form.region} onChange={set('region')}><option value="">Choose…</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></F>
                <F label="District"><input className={inputCls} value={form.district} onChange={set('district')} placeholder="e.g. Kumasi Metro" /></F>
                <F label="Your name"><input className={inputCls} value={form.adminName} onChange={set('adminName')} autoComplete="name" /></F>
                <F label="Your phone"><input className={inputCls} type="tel" value={form.phone} onChange={set('phone')} placeholder="024 412 3456" autoComplete="tel" /></F>
                <F label="Email (you sign in with it)"><input className={inputCls} type="email" value={form.email} onChange={set('email')} autoComplete="email" /></F>
                <F label="Password (8+ characters)"><input className={inputCls} type="password" value={form.password} onChange={set('password')} autoComplete="new-password" /></F>
              </div>
              <label className="flex items-start gap-2 text-sm text-gray-600 mb-2">
                <input type="checkbox" className="mt-0.5 w-4 h-4" checked={form.setupDefaults} onChange={set('setupDefaults')} />
                Set up KG 1 – Basic 6 and the usual primary subjects for me (you can change them)
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-600 mb-4">
                <input type="checkbox" className="mt-0.5 w-4 h-4" checked={form.acceptTerms} onChange={set('acceptTerms')} />
                <span>I agree to the <Link to="/terms" target="_blank" className="text-blue underline">Terms</Link> and the <Link to="/privacy" target="_blank" className="text-blue underline">Privacy Policy</Link>, and I am allowed to sign up for this school.</span>
              </label>
              <button type="submit" disabled={busy} className="w-full py-3.5 bg-blue text-white rounded-xl text-[15px] font-bold disabled:opacity-50">{busy ? 'Please wait…' : 'Continue'}</button>
            </form>
          ) : (
            <form onSubmit={verify} noValidate>
              <div className="flex items-start gap-2 text-sm text-green bg-green-light rounded-xl px-3 py-2.5 mb-4"><CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />{info}</div>
              <F label="6-digit code from the email">
                <input className={`${inputCls} text-center tracking-[0.5em] text-xl font-bold`} inputMode="numeric" maxLength={6} value={code}
                  onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError('') }} autoComplete="one-time-code" />
              </F>
              <button type="submit" disabled={busy || code.length !== 6} className="w-full py-3.5 bg-blue text-white rounded-xl text-[15px] font-bold disabled:opacity-50">{busy ? 'Creating your school…' : 'Create my school'}</button>
              <button type="button" onClick={() => setStep('details')} className="w-full mt-3 text-xs text-blue font-medium">Change the details / send a new code</button>
            </form>
          )}
          {error && <div className="flex items-start gap-2 text-red text-xs bg-red-light border border-red-200 rounded-xl px-3 py-2.5 mt-4"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /><span>{error}</span></div>}
          <div className="text-center mt-5 text-xs text-gray-500">Already using SchoolReport? <Link to="/login" className="text-blue font-medium hover:underline">Sign in</Link></div>
        </div>
      </div>
    </div>
  )
}
