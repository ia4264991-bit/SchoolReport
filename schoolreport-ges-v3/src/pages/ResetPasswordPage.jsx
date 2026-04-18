import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import api from '@/lib/api'
import { Shield, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) setError('Invalid or missing reset token. Please request a new link.')
  }, [token])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (form.newPassword.length < 8) return setError('Password must be at least 8 characters.')
    if (form.newPassword !== form.confirmPassword) return setError('Passwords do not match.')
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/reset-password', { token, newPassword: form.newPassword })
      setSuccess(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      setError(err.response?.data?.message || 'Reset failed. The link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8"
         style={{ background: 'linear-gradient(135deg, #e8f0fb 0%, #f0f4ff 100%)' }}>
      <div className="bg-white border border-[#dde3f0] rounded-[18px] p-9 w-full max-w-sm shadow-lg">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-blue rounded-[14px] flex items-center justify-center mx-auto mb-3">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-[19px] font-bold text-blue">Set New Password</h1>
          <p className="text-xs text-gray-400 mt-1">Choose a strong password (min. 8 characters)</p>
        </div>

        {success ? (
          <div className="text-center">
            <div className="w-14 h-14 bg-green-light rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green" />
            </div>
            <h2 className="font-bold text-gray-800 mb-2">Password Reset!</h2>
            <p className="text-sm text-gray-500">Redirecting to login in 3 seconds…</p>
          </div>
        ) : !token ? (
          <div className="text-center">
            <div className="w-14 h-14 bg-red-light rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-7 h-7 text-red" />
            </div>
            <p className="text-sm text-red mb-4">{error}</p>
            <Link to="/forgot-password" className="text-sm text-blue font-semibold hover:underline">
              Request new reset link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-500 mb-1">New Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.newPassword}
                  onChange={e => { setForm(f => ({ ...f, newPassword: e.target.value })); setError('') }}
                  placeholder="Min. 8 characters"
                  className="w-full pr-10 px-3 py-2.5 border border-[#d0d7e8] rounded-lg text-sm
                             focus:outline-none focus:border-blue transition-all"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Confirm New Password</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={form.confirmPassword}
                onChange={e => { setForm(f => ({ ...f, confirmPassword: e.target.value })); setError('') }}
                placeholder="Repeat password"
                className="w-full px-3 py-2.5 border border-[#d0d7e8] rounded-lg text-sm
                           focus:outline-none focus:border-blue transition-all"
              />
            </div>

            {error && (
              <div className="text-red text-xs bg-red-light border border-red-200 rounded-lg px-3 py-2.5 mb-4">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue text-white rounded-[9px] text-[15px] font-bold
                         hover:bg-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving…' : 'Reset Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
