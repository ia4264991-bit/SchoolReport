import { Routes, Route, Navigate } from 'react-router'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/LoginPage'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage'
import ChangePasswordPage from '@/pages/ChangePasswordPage'
import DashboardPage from '@/pages/DashboardPage'
import ClassesPage from '@/pages/ClassesPage'
import StudentsPage from '@/pages/StudentsPage'
import ScoresPage from '@/pages/ScoresPage'
import ReportsPage from '@/pages/ReportsPage'
import UsersPage from '@/pages/UsersPage'
import SettingsPage from '@/pages/SettingsPage'
import SuperAdminPage from '@/pages/SuperAdminPage'
import MyReportPage from '@/pages/MyReportPage'

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login"           element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/"                element={<Navigate to="/dashboard" replace />} />

      {/* Force password change — authenticated, outside AppLayout */}
      <Route path="/change-password" element={
        <ProtectedRoute><ChangePasswordPage /></ProtectedRoute>
      } />

      {/* Protected app shell */}
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route path="/superadmin" element={
          <ProtectedRoute roles={['superadmin']}><SuperAdminPage /></ProtectedRoute>
        } />
        <Route path="/dashboard" element={
          <ProtectedRoute roles={['admin','head','teacher','student']}><DashboardPage /></ProtectedRoute>
        } />
        <Route path="/reports" element={
          <ProtectedRoute roles={['admin','head','teacher']}><ReportsPage /></ProtectedRoute>
        } />
        <Route path="/my-report" element={
          <ProtectedRoute roles={['student']}><MyReportPage /></ProtectedRoute>
        } />
        <Route path="/classes" element={
          <ProtectedRoute roles={['admin','head']}><ClassesPage /></ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute roles={['admin','head']}><SettingsPage /></ProtectedRoute>
        } />
        <Route path="/students" element={
          <ProtectedRoute roles={['admin','head','teacher']}><StudentsPage /></ProtectedRoute>
        } />
        <Route path="/scores" element={
          <ProtectedRoute roles={['admin','head','teacher']}><ScoresPage /></ProtectedRoute>
        } />
        <Route path="/users" element={
          <ProtectedRoute roles={['admin']}><UsersPage /></ProtectedRoute>
        } />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
