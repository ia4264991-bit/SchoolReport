import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useSchoolStore } from '@/store/schoolStore'
import { Card, CardTitle, Metric, Alert, PageHeader } from '@/components/ui'
import api from '@/lib/api'
import { GraduationCap, Users, BookOpen, FileText, ChevronRight } from 'lucide-react'

const quickLinks = [
  { icon: Users,         label: 'Manage Students',  path: '/students', roles: ['admin','head','teacher'] },
  { icon: BookOpen,      label: 'Enter Scores',      path: '/scores',   roles: ['admin','head','teacher'] },
  { icon: FileText,      label: 'View Reports',      path: '/reports',  roles: ['admin','head','teacher','student'] },
  { icon: GraduationCap, label: 'Manage Classes',    path: '/classes',  roles: ['admin','head'] },
]

export default function DashboardPage() {
  const { user } = useAuthStore()
  const { settings } = useSchoolStore()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)

  useEffect(() => {
    api.get('/school/stats').then(r => setStats(r.data)).catch(() => {})
  }, [])

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const firstName = user?.fullName?.split(' ')[0] || 'there'
  const userLinks = quickLinks.filter(l => l.roles.includes(user?.role))

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${firstName} 👋`}
        subtitle={`${settings?.schoolName || 'SchoolReport GES'} · Term ${settings?.term || '1'}, ${settings?.academicYear || '2024/2025'}`}
      />

      {user?.role === 'teacher' && (
        <Alert variant="info">
          📋 Remember to enter all scores before the deadline. Open <strong>Score Entry</strong> to begin.
        </Alert>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Metric icon={GraduationCap} value={stats?.totalClasses ?? '—'} label="Classes" color="blue" />
        <Metric icon={Users}         value={stats?.totalStudents ?? '—'} label="Students" color="green" />
        <Metric icon={BookOpen}      value={stats?.subjectsCount ?? '—'} label="Subjects" color="amber" />
        <Metric icon={FileText}      value={stats?.reportsGenerated ?? '—'} label="Reports Ready" color="blue" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Quick Actions */}
        <Card>
          <CardTitle>Quick Actions</CardTitle>
          <div className="space-y-1">
            {userLinks.map(({ icon: Icon, label, path }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-blue-light
                           transition-colors text-gray-600 text-sm font-medium group text-left"
              >
                <div className="w-8 h-8 bg-[#f0f5ff] group-hover:bg-blue rounded-lg flex items-center justify-center transition-colors flex-shrink-0">
                  <Icon className="w-4 h-4 text-blue group-hover:text-white transition-colors" />
                </div>
                <span className="flex-1">{label}</span>
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue transition-colors flex-shrink-0" />
              </button>
            ))}
          </div>
        </Card>

        {/* School Info */}
        <Card>
          <CardTitle>School Information</CardTitle>
          <div className="space-y-0">
            {[
              ['School',        settings?.schoolName  || '—'],
              ['Circuit',       settings?.circuit     || '—'],
              ['District',      settings?.district    || '—'],
              ['Region',        settings?.region      || '—'],
              ['Term',          settings?.term ? `Term ${settings.term}` : '—'],
              ['Academic Year', settings?.academicYear|| '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between items-center py-2 border-b border-[#f0f4fb] last:border-0">
                <span className="text-xs text-gray-400 font-medium">{k}</span>
                <span className="text-xs font-semibold text-gray-700 text-right max-w-[60%] truncate">{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
