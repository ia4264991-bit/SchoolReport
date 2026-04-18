import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { Shield, AlertCircle, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, loading } = useAuthStore()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.email || !form.password) { setError('Please enter your email and password.'); return }
    const result = await login(form.email, form.password)
    if (result.success) {
      navigate(result.mustChangePassword ? '/change-password' : '/dashboard')
    } else {
      setError(result.message)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 sm:py-16"
         style={{ background: 'linear-gradient(135deg, #e8f0fb 0%, #f0f4ff 100%)' }}>

      {/* Card */}
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-[#dde3f0] overflow-hidden">

        {/* Header band */}
        <div className="bg-blue px-8 py-7 text-center">
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">SchoolReport GES</h1>
          <p className="text-blue-light text-xs mt-1 opacity-80">Ghana Education Service</p>
        </div>

        <div className="px-6 py-7">
          <p className="text-center text-sm text-gray-500 mb-6">Sign in to your account</p>

          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Email Address</label>
              <input type="email" value={form.email}
                onChange={e => { setForm(f => ({ ...f, email: e.target.value })); setError('') }}
                placeholder="your@email.com"
                className="w-full px-4 py-3 border border-[#d0d7e8] rounded-xl text-sm
                           focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-light
                           transition-all placeholder:text-gray-300"
              />
            </div>

            <div className="mb-5">
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={form.password}
                  onChange={e => { setForm(f => ({ ...f, password: e.target.value })); setError('') }}
                  placeholder="Enter password"
                  className="w-full px-4 py-3 pr-11 border border-[#d0d7e8] rounded-xl text-sm
                             focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-light
                             transition-all placeholder:text-gray-300"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-red text-xs bg-red-light border border-red-200
                              rounded-xl px-3 py-2.5 mb-4">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-3.5 bg-blue text-white rounded-xl text-[15px] font-bold
                         hover:bg-blue-dark active:scale-[0.98] transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue/20">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : 'Sign In →'}
            </button>
          </form>

          <div className="text-center mt-5">
            <Link to="/forgot-password"
              className="text-xs text-blue hover:underline font-medium">
              Forgot your password?
            </Link>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-6 text-center">
        Ghana Education Service · Automated Report System
      </p>
    </div>
  )
}
