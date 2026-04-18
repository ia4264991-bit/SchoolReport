import { useState } from 'react'
import { Link } from 'react-router-dom'
import api from '@/lib/api'
import { Shield, Mail, ArrowLeft, CheckCircle } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email) return setError('Please enter your email address.')
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.')
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
          <h1 className="text-[19px] font-bold text-blue">Forgot Password</h1>
          <p className="text-xs text-gray-400 mt-1">We'll send a reset link to your email</p>
        </div>

        {sent ? (
          <div className="text-center">
            <div className="w-14 h-14 bg-green-light rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green" />
            </div>
            <h2 className="font-bold text-gray-800 mb-2">Check your email</h2>
            <p className="text-sm text-gray-500 mb-5">
              If an account exists for <strong>{email}</strong>, a password reset link has been sent.
              The link expires in 15 minutes.
            </p>
            <Link to="/login" className="text-sm text-blue font-semibold hover:underline flex items-center justify-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  placeholder="your@email.com"
                  className="w-full pl-9 pr-3 py-2.5 border border-[#d0d7e8] rounded-lg text-sm
                             focus:outline-none focus:border-blue transition-all"
                />
              </div>
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
                         hover:bg-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-4"
            >
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>

            <div className="text-center">
              <Link to="/login" className="text-xs text-gray-500 hover:text-blue flex items-center justify-center gap-1">
                <ArrowLeft className="w-3 h-3" /> Back to Login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
