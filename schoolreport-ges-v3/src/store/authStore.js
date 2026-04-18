import { create } from 'zustand'
import api from '@/lib/api'

const storedUser = (() => {
  try { return JSON.parse(localStorage.getItem('ges_user')) } catch { return null }
})()

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
      return { success: true, mustChangePassword: data.mustChangePassword }
    } catch (err) {
      const msg = err.response?.data?.message || 'Invalid email or password.'
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

  clearError: () => set({ error: null }),
  isAuthenticated: () => !!get().token,
  hasRole: (...roles) => roles.includes(get().user?.role),
  isSuperAdmin: () => get().user?.role === 'superadmin',
}))
