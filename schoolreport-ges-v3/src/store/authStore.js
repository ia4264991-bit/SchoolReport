import { create } from 'zustand'
import api from '@/lib/api'

const storedUser = (() => {
  try { return JSON.parse(localStorage.getItem('ges_user')) } catch { return null }
})()

/** Where a user lands after signing in: the superadmin has no school dashboard. */
export const homePath = (user) => (user?.role === 'superadmin' ? '/superadmin' : '/dashboard')

export const useAuthStore = create((set, get) => ({
  user:  storedUser,
  token: localStorage.getItem('ges_token') || null,
  loading: false,
  error: null,

  login: async (email, password) => {
    set({ loading: true, error: null })
    try {
      const { data } = await api.post('/auth/login', { email, password })
      localStorage.setItem('ges_token', data.token)
      localStorage.setItem('ges_user', JSON.stringify(data.user))
      set({ user: data.user, token: data.token, loading: false })
      return { success: true, mustChangePassword: data.mustChangePassword, user: data.user }
    } catch (err) {
      const msg = err.response?.data?.message
        || (err.response ? 'Invalid email or password.' : 'Cannot reach the server. Check your connection.')
      set({ error: msg, loading: false })
      return { success: false, message: msg }
    }
  },

  logout: () => {
    localStorage.removeItem('ges_token')
    localStorage.removeItem('ges_user')
    set({ user: null, token: null })
  },

  updateUser: (updates) => {
    const user = { ...get().user, ...updates }
    localStorage.setItem('ges_user', JSON.stringify(user))
    set({ user })
  },

  /** Re-reads the signed-in user (role, class, …) so admin changes show without logging out. */
  refreshUser: async () => {
    if (!get().token) return
    try {
      const { data } = await api.get('/auth/me')
      localStorage.setItem('ges_user', JSON.stringify(data))
      set({ user: data })
    } catch {
      // 401 is handled by the api interceptor; other errors keep the stored copy.
    }
  },

  clearError: () => set({ error: null }),
  isAuthenticated: () => !!get().token,
  hasRole: (...roles) => roles.includes(get().user?.role),
  isSuperAdmin: () => get().user?.role === 'superadmin',
}))
