import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import api from '@/lib/api'
import { Shield, Eye, EyeOff, Lock } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ChangePasswordPage() {
  const { updateUser, logout } = useAuthStore()
  const navigate = useNavigate()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.newPassword.length < 8) return setError('New password must be at least 8 characters.')
    if (form.newPassword !== form.confirmPassword) return setError('Passwords do not match.')
    if (form.newPassword === form.currentPassword) return setError('New password must differ from current.')

    setLoading(true)
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      })
      updateUser({ mustChangePassword: false })
      toast.success('Password changed successfully!')
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to change password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8"
         style={{ background: 'linear-gradient(135deg, #e8f0fb 0%, #f0f4ff 100%)' }}>
      <div className="bg-white border border-[#dde3f0] rounded-[18px] p-9 w-full max-w-sm shadow-lg">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-amber rounded-[14px] flex items-center justify-center mx-auto mb-3">
            <Lock className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-[19px] font-bold text-amber">Change Your Password</h1>
          <p className="text-xs text-gray-400 mt-1">You must set a new password before continuing</p>
        </div>

        <div className="bg-amber-light border border-[#FAC775] rounded-lg px-3 py-2.5 mb-5 text-xs text-amber font-medium">
          ⚠️ This is your first login. Please set a secure password to continue.
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {[
            { label: 'Current (Temporary) Password', key: 'currentPassword', placeholder: 'Your temporary password' },
            { label: 'New Password', key: 'newPassword', placeholder: 'Min. 8 characters' },
            { label: 'Confirm New Password', key: 'confirmPassword', placeholder: 'Repeat new password' },
          ].map(({ label, key, placeholder }) => (
            <div key={key} className="mb-3">
              <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form[key]}
                  onChange={e => { setForm(f => ({ ...f, [key]: e.target.value })); setError('') }}
                  placeholder={placeholder}
                  className="w-full pr-10 px-3 py-2.5 border border-[#d0d7e8] rounded-lg text-sm
                             focus:outline-none focus:border-blue transition-all"
                />
                {key === 'newPassword' && (
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>
          ))}

          {error && (
            <div className="text-red text-xs bg-red-light border border-red-200 rounded-lg px-3 py-2.5 mb-4">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue text-white rounded-[9px] text-[15px] font-bold
                       hover:bg-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-3"
          >
            {loading ? 'Saving…' : 'Set New Password →'}
          </button>
          <button type="button" onClick={logout}
            className="w-full text-xs text-gray-400 hover:text-red transition-colors">
            Sign out instead
          </button>
        </form>
      </div>
    </div>
  )
}
