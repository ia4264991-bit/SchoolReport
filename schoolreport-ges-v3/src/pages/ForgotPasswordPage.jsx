import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import { Shield, Mail, ArrowLeft, CheckCircle, Eye, EyeOff, KeyRound } from 'lucide-react'

const STEPS = { EMAIL: 'email', OTP: 'otp', PASSWORD: 'password', DONE: 'done' }

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step,      setStep]      = useState(STEPS.EMAIL)
  const [email,     setEmail]     = useState('')
  const [otp,       setOtp]       = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw,    setShowPw]    = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')

  const handleSendOTP = async (e) => {
    e.preventDefault()
    if (!email.trim()) return setError('Please enter your email address.')
    setLoading(true); setError('')
    try {
      await api.post('/auth/forgot-password', { email: email.trim() })
      setStep(STEPS.OTP)
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Try again.')
    } finally { setLoading(false) }
  }

  const handleVerifyOTP = async (e) => {
    e.preventDefault()
    if (otp.trim().length !== 6) return setError('Please enter the 6-digit code.')
    setLoading(true); setError('')
    try {
      await api.post('/auth/verify-otp', { email: email.trim(), otp: otp.trim() })
      setStep(STEPS.PASSWORD)
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid or expired code.')
    } finally { setLoading(false) }
  }

  const handleReset = async (e) => {
    e.preventDefault()
    if (newPw.length < 8) return setError('Password must be at least 8 characters.')
    if (newPw !== confirmPw) return setError('Passwords do not match.')
    setLoading(true); setError('')
    try {
      await api.post('/auth/reset-password', { email: email.trim(), otp: otp.trim(), newPassword: newPw })
      setStep(STEPS.DONE)
    } catch (err) {
      setError(err.response?.data?.message || 'Reset failed. Please start again.')
    } finally { setLoading(false) }
  }

  const inputCls = 'w-full px-4 py-3 border border-[#d0d7e8] rounded-xl text-sm focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-light transition-all placeholder:text-gray-300'
  const btnCls   = 'w-full py-3.5 bg-blue text-white rounded-xl text-[15px] font-bold hover:bg-blue-dark active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed'
  const stepNum  = { [STEPS.EMAIL]: 1, [STEPS.OTP]: 2, [STEPS.PASSWORD]: 3 }[step] || 0
  const spinner  = <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Loading…</span>

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
         style={{ background: 'linear-gradient(135deg, #e8f0fb 0%, #f0f4ff 100%)' }}>
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-[#dde3f0] overflow-hidden">

        {/* Header */}
        <div className="bg-blue px-8 py-6 text-center">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-2">
            <KeyRound className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-lg font-bold text-white">Reset Password</h1>
          {step !== STEPS.DONE && (
            <div className="flex justify-center gap-2 mt-3">
              {[1,2,3].map(n => (
                <div key={n} className={`h-1.5 rounded-full transition-all duration-300 ${n <= stepNum ? 'w-8 bg-white' : 'w-4 bg-white/30'}`} />
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-7">

          {/* STEP 1 — Email */}
          {step === STEPS.EMAIL && (
            <>
              <p className="text-sm text-gray-500 text-center mb-5">Enter your email and we'll send you a 6-digit reset code.</p>
              <form onSubmit={handleSendOTP} noValidate>
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input type="email" value={email}
                      onChange={e => { setEmail(e.target.value); setError('') }}
                      placeholder="your@email.com"
                      className={inputCls + ' pl-10'} />
                  </div>
                </div>
                {error && <div className="text-red text-xs bg-red-light border border-red-200 rounded-xl px-3 py-2.5 mb-4">{error}</div>}
                <button type="submit" disabled={loading} className={btnCls}>{loading ? spinner : 'Send Reset Code'}</button>
              </form>
            </>
          )}

          {/* STEP 2 — OTP */}
          {step === STEPS.OTP && (
            <>
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-blue-light rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Mail className="w-7 h-7 text-blue" />
                </div>
                <p className="text-sm font-semibold text-gray-700">Check your email</p>
                <p className="text-xs text-gray-400 mt-1">6-digit code sent to <strong className="text-gray-600">{email}</strong></p>
                <p className="text-xs text-gray-400 mt-0.5">Also check your spam folder.</p>
              </div>
              <form onSubmit={handleVerifyOTP} noValidate>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 text-center">Enter 6-digit OTP</label>
                <input type="text" inputMode="numeric" maxLength={6} value={otp}
                  onChange={e => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
                  placeholder="000000"
                  className={inputCls + ' text-center text-2xl font-bold tracking-[0.5em] mb-4'} />
                {error && <div className="text-red text-xs bg-red-light border border-red-200 rounded-xl px-3 py-2.5 mb-4">{error}</div>}
                <button type="submit" disabled={loading || otp.length !== 6} className={btnCls}>{loading ? spinner : 'Verify Code'}</button>
                <button type="button" onClick={() => { setStep(STEPS.EMAIL); setOtp(''); setError('') }}
                  className="w-full text-xs text-gray-400 hover:text-blue mt-3 transition-colors">
                  ← Didn't receive it? Go back
                </button>
              </form>
            </>
          )}

          {/* STEP 3 — New Password */}
          {step === STEPS.PASSWORD && (
            <>
              <p className="text-sm text-gray-500 text-center mb-5">OTP verified ✓ — set your new password.</p>
              <form onSubmit={handleReset} noValidate>
                <div className="mb-3">
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">New Password</label>
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} value={newPw}
                      onChange={e => { setNewPw(e.target.value); setError('') }}
                      placeholder="Min. 8 characters" className={inputCls + ' pr-11'} />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="mb-5">
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Confirm Password</label>
                  <input type={showPw ? 'text' : 'password'} value={confirmPw}
                    onChange={e => { setConfirmPw(e.target.value); setError('') }}
                    placeholder="Repeat new password" className={inputCls} />
                </div>
                {error && <div className="text-red text-xs bg-red-light border border-red-200 rounded-xl px-3 py-2.5 mb-4">{error}</div>}
                <button type="submit" disabled={loading} className={btnCls}>{loading ? spinner : 'Set New Password'}</button>
              </form>
            </>
          )}

          {/* DONE */}
          {step === STEPS.DONE && (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-green-light rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green" />
              </div>
              <h2 className="font-bold text-gray-800 text-lg mb-2">Password Reset!</h2>
              <p className="text-sm text-gray-500 mb-6">Your password has been updated. You can now log in.</p>
              <button onClick={() => navigate('/login')} className={btnCls}>Go to Login →</button>
            </div>
          )}

          {step !== STEPS.DONE && (
            <div className="text-center mt-5">
              <Link to="/login" className="text-xs text-gray-400 hover:text-blue flex items-center justify-center gap-1 transition-colors">
                <ArrowLeft className="w-3 h-3" /> Back to Login
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
