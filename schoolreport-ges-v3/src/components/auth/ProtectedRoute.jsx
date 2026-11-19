import { Navigate, useLocation } from 'react-router'
import { useAuthStore } from '@/store/authStore'

export default function ProtectedRoute({ children, roles }) {
  const { user, token } = useAuthStore()
  const location = useLocation()

  // Not logged in at all
  if (!token || !user) {
    // Parents arrive from SMS links to /parent: send them to the phone sign-in.
    const login = location.pathname.startsWith('/parent') ? '/parent-login' : '/login'
    return <Navigate to={login} replace state={{ from: location }} />
  }

  // Force password change — redirect to /change-password unless already there
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  // Role-based access check
  if (roles && !roles.includes(user.role)) {
    // Superadmin goes to their own dashboard, everyone else to /dashboard
    const fallback = { superadmin: '/superadmin', parent: '/parent', bursar: '/fees' }[user.role] || '/dashboard'
    return <Navigate to={fallback} replace />
  }

  return children
}
