import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuthStore } from '@/store/authStore'
import api from '@/lib/api'
import { Shield, AlertCircle, Smartphone } from 'lucide-react'

const inputCls = 'w-full px-4 py-3 border border-[#d0d7e8] rounded-xl text-base focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-light transition-all placeholder:text-gray-300'

/**
 * Parents sign in with the phone number the school has for their child and a 6-digit code
 * sent to it by SMS. No email or password.
 */
export default function ParentLoginPage() {
  const navigate = useNavigate()
  const { setSession } = useAuthStore()
  const [step, setStep] = useState('phone') // phone | code | school
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [schools, setSchools] = useState([])
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const fail = (err, fallback) => setError(err.response?.data?.message || (err.response ? fallback : 'Cannot reach the server. Check your connection.'))

  const requestCode = async (e) => {
    e?.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { data } = await api.post('/auth/parent/request-code', { phone })
      setInfo(data.message)
      setStep('code')
    } catch (err) { fail(err, 'Could not send the code.') } finally { setBusy(false) }
  }

  const verify = async (e, schoolId) => {
    e?.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { data } = await api.post('/auth/parent/verify', { phone, code: code.trim(), ...(schoolId ? { schoolId } : {}) })
      if (data.chooseSchool) { setSchools(data.chooseSchool); setStep('school'); return }
      setSession(data.token, data.user)
      navigate('/parent')
    } catch (err) { fail(err, 'Wrong or expired code.') } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10" style={{ background: 'linear-gradient(135deg, #e8f0fb 0%, #f0f4ff 100%)' }}>
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-[#dde3f0] overflow-hidden">
        <div className="bg-blue px-8 py-6 text-center">
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3"><Smartphone className="w-8 h-8 text-white" /></div>
          <h1 className="text-xl font-bold text-white">Parents</h1>
          <p className="text-blue-light text-xs mt-1 opacity-80">Reports, attendance and fees for your child</p>
        </div>
        <div className="px-6 py-6">
          {step === 'phone' && (
            <form onSubmit={requestCode} noValidate>
              <p className="text-sm text-gray-500 mb-4">Enter the phone number the school has for your child. We will send you a code by SMS.</p>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5" htmlFor="phone">Phone number</label>
              <input id="phone" type="tel" inputMode="tel" autoComplete="tel" className={inputCls} placeholder="024 412 3456"
                value={phone} onChange={(e) => { setPhone(e.target.value); setError('') }} />
              <button type="submit" disabled={busy || !phone.trim()} className="w-full mt-5 py-3.5 bg-blue text-white rounded-xl text-[15px] font-bold disabled:opacity-50">
                {busy ? 'Sending…' : 'Send me a code'}
              </button>
            </form>
          )}
          {step === 'code' && (
            <form onSubmit={verify} noValidate>
              <p className="text-sm text-gray-500 mb-4">{info}</p>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5" htmlFor="code">6-digit code</label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={`${inputCls} text-center tracking-[0.5em] text-xl font-bold`}
                value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError('') }} />
              <button type="submit" disabled={busy || code.length !== 6} className="w-full mt-5 py-3.5 bg-blue text-white rounded-xl text-[15px] font-bold disabled:opacity-50">
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <button type="button" onClick={() => { setStep('phone'); setCode('') }} className="w-full mt-3 text-xs text-blue font-medium">Use another number / send a new code</button>
            </form>
          )}
          {step === 'school' && (
            <div>
              <p className="text-sm text-gray-500 mb-3">Your number is on record at more than one school. Which one?</p>
              {schools.map((s) => (
                <button key={s._id} onClick={(e) => verify(e, s._id)} disabled={busy}
                  className="w-full text-left px-4 py-3 mb-2 border border-border rounded-xl font-semibold text-sm hover:border-blue hover:bg-blue-light">{s.name}</button>
              ))}
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 text-red text-xs bg-red-light border border-red-200 rounded-xl px-3 py-2.5 mt-4">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}
          <div className="text-center mt-5"><Link to="/login" className="text-xs text-blue hover:underline font-medium">School staff? Sign in here</Link></div>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-6 flex items-center gap-1"><Shield className="w-3 h-3" /> SchoolReport</p>
    </div>
  )
}
