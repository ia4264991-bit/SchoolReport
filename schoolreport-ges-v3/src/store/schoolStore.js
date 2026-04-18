import { create } from 'zustand'
import api from '@/lib/api'

export const useSchoolStore = create((set) => ({
  settings: null,
  classes: [],
  subjects: [],
  loading: false,

  fetchSettings: async () => {
    try {
      const { data } = await api.get('/school/settings')
      set({ settings: data })
    } catch (err) {
      // Silently ignore — superadmin has no school context
      if (err.response?.status !== 403) console.error('[SchoolStore] fetchSettings:', err.message)
    }
  },

  fetchClasses: async () => {
    set({ loading: true })
    try {
      const { data } = await api.get('/school/classes')
      set({ classes: data, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchSubjects: async () => {
    try {
      const { data } = await api.get('/school/subjects')
      set({ subjects: data })
    } catch {}
  },

  updateSettings: async (payload) => {
    const { data } = await api.put('/school/settings', payload)
    set({ settings: data })
  },
}))
