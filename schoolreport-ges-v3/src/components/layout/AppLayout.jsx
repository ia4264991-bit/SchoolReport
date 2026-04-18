import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useSchoolStore } from '@/store/schoolStore'
import { useEffect, useState } from 'react'
import {
  Shield, LogOut, LayoutDashboard, Users, BookOpen,
  ClipboardList, FileText, Settings, GraduationCap,
  Building2, Menu, X, ChevronRight
} from 'lucide-react'
import clsx from 'clsx'

const ROLE_BADGE = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin:      'bg-blue-light text-blue',
  head:       'bg-green-light text-green',
  teacher:    'bg-amber-light text-amber',
  student:    'bg-gray-100 text-gray-600',
}
const ROLE_LABEL = {
  superadmin: 'Super Admin',
  admin:      'School Admin',
  head:       'Head Teacher',
  teacher:    'Class Teacher',
  student:    'Student',
}

function getNavItems(role) {
  const all = [
    { path: '/superadmin', icon: Building2,      label: 'Platform Control', roles: ['superadmin'] },
    { path: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard',       roles: ['admin','head','teacher','student'] },
    { path: '/classes',    icon: GraduationCap,   label: 'Classes',         roles: ['admin','head'] },
    { path: '/students',   icon: Users,            label: 'Students',        roles: ['admin','head','teacher'] },
    { path: '/scores',     icon: BookOpen,         label: 'Score Entry',     roles: ['admin','head','teacher'] },
    { path: '/reports',    icon: FileText,         label: 'Reports',         roles: ['admin','head','teacher','student'] },
    { path: '/users',      icon: ClipboardList,    label: 'User Mgmt',       roles: ['admin'] },
    { path: '/settings',   icon: Settings,         label: 'Settings',        roles: ['admin','head'] },
  ]
  return all.filter(n => n.roles.includes(role))
}

function NavItem({ path, icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] mb-0.5',
        'transition-all duration-150 select-none text-left',
        active
          ? 'bg-blue-light text-blue font-bold'
          : 'text-gray-500 hover:bg-[#f0f5ff] hover:text-blue active:bg-blue-light'
      )}
    >
      <Icon className={clsx('w-[18px] h-[18px] flex-shrink-0', active ? 'text-blue' : 'text-gray-400')} />
      <span className="flex-1 truncate">{label}</span>
      {active && <ChevronRight className="w-3 h-3 text-blue opacity-50 flex-shrink-0" />}
    </button>
  )
}

function SidebarContent({ user, settings, location, onNavigate, onLogout }) {
  const schoolLabel = user?.role === 'superadmin'
    ? 'Platform Administration'
    : (settings?.schoolName || 'Ghana Education Service')

  const initials = user?.fullName?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'U'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="text-[10px] text-gray-400 px-4 pt-4 pb-1 uppercase tracking-widest font-bold">
        Navigation
      </div>
      <nav className="flex-1 px-2 py-1 overflow-y-auto">
        {getNavItems(user?.role).map(item => (
          <NavItem
            key={item.path}
            {...item}
            active={location.pathname === item.path || location.pathname.startsWith(item.path + '/')}
            onClick={() => onNavigate(item.path)}
          />
        ))}
      </nav>
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#f8faff]">
          <div className={clsx(
            'w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0',
            ROLE_BADGE[user?.role]
          )}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-gray-800 truncate">{user?.fullName}</div>
            <div className="text-[10px] text-gray-400 truncate">{schoolLabel}</div>
          </div>
          <button
            onClick={onLogout}
            title="Sign Out"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red hover:bg-red-light transition-all flex-shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AppLayout() {
  const { user, logout } = useAuthStore()
  const { settings, fetchSettings } = useSchoolStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (user?.role !== 'superadmin') fetchSettings()
  }, [])

  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  const handleLogout = () => { logout(); navigate('/login') }
  const handleNav = (path) => { navigate(path); setDrawerOpen(false) }

  return (
    <div className="min-h-screen flex flex-col bg-bg">

      {/* ── TOPBAR ── */}
      <header className="no-print sticky top-0 z-40 bg-white border-b border-border shadow-sm">
        <div className="flex items-center justify-between px-4 sm:px-5 h-14">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawerOpen(v => !v)}
              className="lg:hidden p-2 -ml-1 rounded-lg text-gray-500 hover:bg-blue-light hover:text-blue transition-all"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-blue rounded-lg flex items-center justify-center">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="font-bold text-[15px] text-blue leading-tight">SchoolReport GES</div>
                <div className="text-[10px] text-gray-400 hidden sm:block">
                  {user?.role === 'superadmin' ? 'Platform Administration' : (settings?.schoolName || 'Ghana Education Service')}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <span className={clsx('hidden sm:inline-flex text-[11px] px-2.5 py-1 rounded-full font-bold', ROLE_BADGE[user?.role])}>
              {ROLE_LABEL[user?.role]}
            </span>
            <span className="hidden md:block text-[13px] font-semibold text-gray-700 max-w-[160px] truncate">
              {user?.fullName}
            </span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 border border-[#d0d7e8]
                         rounded-lg bg-white text-gray-500 hover:bg-red-light hover:text-red hover:border-red-300 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">

        {/* ── MOBILE OVERLAY ── */}
        {drawerOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            onClick={() => setDrawerOpen(false)}
          />
        )}

        {/* ── MOBILE DRAWER ── */}
        <aside className={clsx(
          'no-print fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-white z-50 shadow-2xl flex flex-col',
          'transition-transform duration-300 ease-in-out lg:hidden',
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        )}>
          <div className="flex items-center justify-between px-4 h-14 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-blue rounded-lg flex items-center justify-center">
                <Shield className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-bold text-[14px] text-blue">SchoolReport GES</span>
            </div>
            <button onClick={() => setDrawerOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <SidebarContent user={user} settings={settings} location={location} onNavigate={handleNav} onLogout={handleLogout} />
          </div>
        </aside>

        {/* ── DESKTOP SIDEBAR ── */}
        <aside className="no-print hidden lg:flex lg:flex-col w-56 xl:w-60 border-r border-border bg-white flex-shrink-0">
          <SidebarContent user={user} settings={settings} location={location} onNavigate={handleNav} onLogout={handleLogout} />
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="flex-1 overflow-auto">
          <div className="p-4 sm:p-5 lg:p-6 max-w-screen-xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
