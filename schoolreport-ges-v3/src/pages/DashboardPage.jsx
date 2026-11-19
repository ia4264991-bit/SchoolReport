import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useAuthStore } from '@/store/authStore'
import { useSchoolStore } from '@/store/schoolStore'
import { Card, CardTitle, Metric, Alert, PageHeader } from '@/components/ui'
import api from '@/lib/api'
import { GraduationCap, Users, BookOpen, FileText, ChevronRight, ClipboardCheck, Wallet, Megaphone, CheckCircle2 } from 'lucide-react'
import { todayIso } from '@/lib/format'

const quickLinks = [
  { icon: ClipboardCheck, label: "Take today's register", path: '/attendance', roles: ['admin','head','teacher'] },
  { icon: Users,         label: 'Manage Students',  path: '/students', roles: ['admin','head','teacher'] },
  { icon: BookOpen,      label: 'Enter Scores',      path: '/scores',   roles: ['admin','head','teacher'] },
  { icon: FileText,      label: 'View Reports',      path: '/reports',  roles: ['admin','head','teacher'] },
  { icon: GraduationCap, label: 'Manage Classes',    path: '/classes',  roles: ['admin','head'] },
  { icon: Wallet,        label: 'School Fees',       path: '/fees',     roles: ['admin','head'] },
  { icon: Megaphone,     label: 'Message Parents',   path: '/messages', roles: ['admin','head'] },
  { icon: FileText,      label: 'View My Report',    path: '/my-report', roles: ['student'] },
]

export default function DashboardPage() {
  const { user } = useAuthStore()
  const { settings, logoUrl } = useSchoolStore()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [register, setRegister] = useState(null)
  const [overview, setOverview] = useState(null)
  const [params] = useSearchParams()
  const isStudent = user?.role === 'student'
  const isTeacher = user?.role === 'teacher'
  const isLeader = user?.role === 'admin' || user?.role === 'head'

  useEffect(() => {
    // School-wide counts are for staff; a student's dashboard just points to their report.
    if (!isStudent) api.get('/school/stats').then(r => setStats(r.data)).catch(() => {})
    if (isTeacher && user?.classId) api.get(`/attendance/${user.classId}`, { params: { day: todayIso() } }).then(r => setRegister(r.data)).catch(() => {})
    if (isLeader) api.get('/attendance/overview').then(r => setOverview(r.data)).catch(() => {})
  }, [isStudent, isTeacher, isLeader, user?.classId])

  const presentToday = register?.students.filter(s => s.status === 'present').length ?? 0
  const absentToday = register?.students.filter(s => s.status === 'absent').length ?? 0

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
        subtitle={[settings?.schoolName || 'SchoolReport GES', settings && `Term ${settings.term}, ${settings.academicYear}`].filter(Boolean).join(' · ')}
      />

      {params.get('welcome') && user?.role === 'admin' && (
        <Card>
          <div className="font-bold text-gray-900 mb-2">Welcome! Your school is ready. Four steps to get going:</div>
          {[
            ['Add your pupils — or import the class lists you already have in Excel', '/students'],
            ['Add your teachers and assign each one a class', '/users'],
            ['Check the grading scale and the classes and subjects we set up for you', '/settings'],
            ["Set this term's fees, then bill the pupils", '/fees'],
          ].map(([t, path], i) => (
            <button key={path} onClick={() => navigate(path)} className="w-full flex items-center gap-3 py-2 text-left text-sm text-gray-700 hover:text-blue">
              <span className="w-6 h-6 rounded-full bg-blue-light text-blue text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>{t}
            </button>
          ))}
        </Card>
      )}

      {isTeacher && user?.classId && register && (
        <button onClick={() => navigate('/attendance')}
          className={`w-full mb-4 rounded-2xl p-5 text-left shadow-sm border flex items-center gap-4 ${register.register ? 'bg-green-light border-[#C0DD97]' : 'bg-blue text-white border-blue'}`}>
          {register.register
            ? <CheckCircle2 className="w-10 h-10 text-green flex-shrink-0" />
            : <ClipboardCheck className="w-10 h-10 flex-shrink-0" />}
          <div className="flex-1">
            <div className={`text-lg font-bold ${register.register ? 'text-green' : ''}`}>
              {register.register ? "Today's register is taken" : "Take today's register"}
            </div>
            <div className={`text-sm ${register.register ? 'text-green' : 'opacity-90'}`}>
              {register.register ? `${presentToday} present · ${absentToday} absent` : `${register.class?.name} · ${register.students.length} pupils`}
            </div>
          </div>
          <ChevronRight className="w-5 h-5 opacity-60" />
        </button>
      )}

      {isLeader && overview && overview.classes.length > 0 && (
        <button onClick={() => navigate('/attendance')} className="w-full mb-4 text-left">
          <Alert variant={overview.classes.every(c => c.taken) ? 'ok' : 'warn'}>
            <ClipboardCheck className="w-4 h-4 inline mr-1" />
            Today's registers: <strong>{overview.classes.filter(c => c.taken).length} of {overview.classes.length}</strong> classes taken
            {overview.classes.some(c => c.taken) && ` · ${overview.classes.reduce((a, c) => a + c.absent, 0)} pupil(s) absent`}
            {!overview.classes.every(c => c.taken) && ` · not yet: ${overview.classes.filter(c => !c.taken).map(c => c.className).slice(0, 4).join(', ')}${overview.classes.filter(c => !c.taken).length > 4 ? '…' : ''}`}
          </Alert>
        </button>
      )}

      {user?.role === 'teacher' && (
        <Alert variant="info">
          📋 Remember to enter all scores before the deadline. Open <strong>Score Entry</strong> to begin.
        </Alert>
      )}

      {user?.role === 'teacher' && !user.classId && (
        <Alert variant="warn">
          You have no class assigned yet. Ask your school admin to assign you a class in User Mgmt.
        </Alert>
      )}

      {isStudent && (
        <Alert variant="info">
          📄 Your report for each term is under <strong>My Report</strong> — you can print it or save it as PDF.
        </Alert>
      )}

      {/* Metrics (staff only) */}
      {!isStudent && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Metric icon={GraduationCap} value={stats?.totalClasses ?? '—'} label="Classes" color="blue" />
          <Metric icon={Users}         value={stats?.totalStudents ?? '—'} label="Students" color="green" />
          <Metric icon={BookOpen}      value={stats?.subjectsCount ?? '—'} label="Subjects" color="amber" />
          <Metric icon={FileText}      value={stats?.reportsGenerated ?? '—'} label="Students Scored This Term" color="blue" />
        </div>
      )}

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
          <div className="flex items-center gap-3 mb-3">
            {logoUrl && (
              <img src={logoUrl} alt="School logo"
                className="w-12 h-12 rounded-lg object-contain bg-white border border-border p-0.5 flex-shrink-0" />
            )}
            <div className="font-bold text-sm text-gray-900">School Information</div>
          </div>
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
