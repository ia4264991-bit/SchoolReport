import axios from 'axios'

// Production: VITE_API_URL is the backend's full API address, e.g. https://your-backend.onrender.com/api
// Local dev: leave it unset — requests go to /api and Vite proxies them to localhost:3000.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
})

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ges_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// A 401 on a request that carried a token means the session ended (expired, account or
// school deactivated): clear it and go to the login page. A 401 without a token — e.g.
// a wrong password on the login form — is left for the page to show.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const sentToken = Boolean(err.config?.headers?.Authorization)
    if (err.response?.status === 401 && sentToken) {
      localStorage.removeItem('ges_token')
      localStorage.removeItem('ges_user')
      if (window.location.pathname !== '/login') window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

/**
 * The server's error message, or a fallback. For server errors it adds a short reference
 * (start of the request id) that support can look up in the server logs.
 */
export const errorMessage = (err, fallback = 'Something went wrong.') => {
  const data = err?.response?.data
  const msg = data?.message || (err?.response ? fallback : 'Cannot reach the server. Check your connection.')
  return data?.requestId ? `${msg} (ref ${String(data.requestId).slice(0, 8)})` : msg
}

export default api
