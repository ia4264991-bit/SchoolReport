import { create } from 'zustand'
import api from '@/lib/api'

const EMPTY = { settings: null, classes: [], subjects: [], loading: false, logoUrl: null, logoVersion: null }

export const useSchoolStore = create((set, get) => ({
  ...EMPTY,

  fetchSettings: async () => {
    try {
      const { data } = await api.get('/school/settings')
      set({ settings: data })
      get().loadLogo(data.logoVersion)
    } catch (err) {
      // Silently ignore — superadmin has no school context
      if (err.response?.status !== 403) console.error('[SchoolStore] fetchSettings:', err.message)
    }
  },

  /**
   * Loads the school logo as a local object URL (the request needs the login token, so a
   * plain <img src> to the API would not work). `version` changes whenever the logo does.
   */
  loadLogo: async (version) => {
    const { logoUrl, logoVersion } = get()
    if (!version) {
      if (logoUrl) URL.revokeObjectURL(logoUrl)
      set({ logoUrl: null, logoVersion: null })
      return
    }
    if (version === logoVersion && logoUrl) return
    try {
      const { data } = await api.get('/school/logo', { params: { v: version }, responseType: 'blob' })
      if (get().logoUrl) URL.revokeObjectURL(get().logoUrl)
      set({ logoUrl: URL.createObjectURL(data), logoVersion: version })
    } catch {
      // No logo or offline: pages simply show none.
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

  /** Forget everything about the previous school (on sign-out). */
  reset: () => {
    const { logoUrl } = get()
    if (logoUrl) URL.revokeObjectURL(logoUrl)
    set(EMPTY)
  },
}))
