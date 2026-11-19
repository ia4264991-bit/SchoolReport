import { Routes, Route, Navigate } from 'react-router'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/LoginPage'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage'
import ChangePasswordPage from '@/pages/ChangePasswordPage'
import ParentLoginPage from '@/pages/ParentLoginPage'
import SignupPage from '@/pages/SignupPage'
import { PrivacyPage, TermsPage } from '@/pages/LegalPages'
import DashboardPage from '@/pages/DashboardPage'
import ClassesPage from '@/pages/ClassesPage'
import StudentsPage from '@/pages/StudentsPage'
import ScoresPage from '@/pages/ScoresPage'
import ReportsPage from '@/pages/ReportsPage'
import UsersPage from '@/pages/UsersPage'
import SettingsPage from '@/pages/SettingsPage'
import SuperAdminPage from '@/pages/SuperAdminPage'
import MyReportPage from '@/pages/MyReportPage'
import AttendancePage from '@/pages/AttendancePage'
import PrintoutsPage from '@/pages/PrintoutsPage'
import FeesPage from '@/pages/FeesPage'
import MessagesPage from '@/pages/MessagesPage'
import BillingPage from '@/pages/BillingPage'
import ParentPage from '@/pages/ParentPage'

const STAFF = ['admin', 'head', 'teacher']

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login"           element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/parent-login"    element={<ParentLoginPage />} />
      <Route path="/signup"          element={<SignupPage />} />
      <Route path="/privacy"         element={<PrivacyPage />} />
      <Route path="/terms"           element={<TermsPage />} />
      <Route path="/"                element={<Navigate to="/dashboard" replace />} />

      {/* Force password change — authenticated, outside AppLayout */}
      <Route path="/change-password" element={
        <ProtectedRoute><ChangePasswordPage /></ProtectedRoute>
      } />

      {/* Protected app shell */}
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route path="/superadmin" element={<ProtectedRoute roles={['superadmin']}><SuperAdminPage /></ProtectedRoute>} />
        <Route path="/dashboard"  element={<ProtectedRoute roles={[...STAFF, 'student']}><DashboardPage /></ProtectedRoute>} />
        <Route path="/attendance" element={<ProtectedRoute roles={STAFF}><AttendancePage /></ProtectedRoute>} />
        <Route path="/reports"    element={<ProtectedRoute roles={STAFF}><ReportsPage /></ProtectedRoute>} />
        <Route path="/printouts"  element={<ProtectedRoute roles={[...STAFF, 'bursar']}><PrintoutsPage /></ProtectedRoute>} />
        <Route path="/my-report"  element={<ProtectedRoute roles={['student']}><MyReportPage /></ProtectedRoute>} />
        <Route path="/parent"     element={<ProtectedRoute roles={['parent']}><ParentPage /></ProtectedRoute>} />
        <Route path="/classes"    element={<ProtectedRoute roles={['admin', 'head']}><ClassesPage /></ProtectedRoute>} />
        <Route path="/settings"   element={<ProtectedRoute roles={['admin', 'head']}><SettingsPage /></ProtectedRoute>} />
        <Route path="/students"   element={<ProtectedRoute roles={STAFF}><StudentsPage /></ProtectedRoute>} />
        <Route path="/scores"     element={<ProtectedRoute roles={STAFF}><ScoresPage /></ProtectedRoute>} />
        <Route path="/fees"       element={<ProtectedRoute roles={['admin', 'head', 'bursar']}><FeesPage /></ProtectedRoute>} />
        <Route path="/messages"   element={<ProtectedRoute roles={['admin', 'head']}><MessagesPage /></ProtectedRoute>} />
        <Route path="/billing"    element={<ProtectedRoute roles={['admin', 'head']}><BillingPage /></ProtectedRoute>} />
        <Route path="/users"      element={<ProtectedRoute roles={['admin']}><UsersPage /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
