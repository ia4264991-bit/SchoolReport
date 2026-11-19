import { Outlet, useNavigate, useLocation, Link } from 'react-router'
import toast from 'react-hot-toast'
import { syncRegisters } from '@/lib/offline'
import { useAuthStore } from '@/store/authStore'
import { useSchoolStore } from '@/store/schoolStore'
import { useEffect, useState } from 'react'
import {
  Shield, LogOut, LayoutDashboard, Users, BookOpen,
  ClipboardList, FileText, Settings, GraduationCap,
  Building2, Menu, X, ChevronRight, ClipboardCheck, Wallet, Megaphone, Printer, CreditCard
} from 'lucide-react'
import clsx from 'clsx'

const ROLE_BADGE = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin:      'bg-blue-light text-blue',
  head:       'bg-green-light text-green',
  teacher:    'bg-amber-light text-amber',
  bursar:     'bg-blue-light text-blue',
  student:    'bg-gray-100 text-gray-600',
  parent:     'bg-green-light text-green',
}
const ROLE_LABEL = {
  superadmin: 'Super Admin',
  admin:      'School Admin',
  head:       'Head Teacher',
  teacher:    'Class Teacher',
  bursar:     'Bursar',
  student:    'Student',
  parent:     'Parent',
}

function getNavItems(role) {
  const all = [
    { path: '/superadmin', icon: Building2,      label: 'Platform Control', roles: ['superadmin'] },
    { path: '/parent',     icon: Users,            label: 'My Children',     roles: ['parent'] },
    { path: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard',       roles: ['admin','head','teacher','student'] },
    { path: '/attendance', icon: ClipboardCheck,  label: 'Attendance',      roles: ['admin','head','teacher'] },
    { path: '/classes',    icon: GraduationCap,   label: 'Classes',         roles: ['admin','head'] },
    { path: '/students',   icon: Users,            label: 'Students',        roles: ['admin','head','teacher'] },
    { path: '/scores',     icon: BookOpen,         label: 'Score Entry',     roles: ['admin','head','teacher'] },
    { path: '/reports',    icon: FileText,         label: 'Reports',         roles: ['admin','head','teacher'] },
    { path: '/printouts',  icon: Printer,          label: 'End of Term',     roles: ['admin','head','teacher','bursar'] },
    { path: '/fees',       icon: Wallet,           label: 'School Fees',     roles: ['admin','head','bursar'] },
    { path: '/messages',   icon: Megaphone,        label: 'Messages',        roles: ['admin','head'] },
    { path: '/my-report',  icon: FileText,         label: 'My Report',       roles: ['student'] },
    { path: '/users',      icon: ClipboardList,    label: 'User Mgmt',       roles: ['admin'] },
    { path: '/billing',    icon: CreditCard,       label: 'Billing',         roles: ['admin','head'] },
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
  const { user, logout, refreshUser } = useAuthStore()
  const { settings, fetchSettings, logoUrl, reset: resetSchool } = useSchoolStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    // Pick up role/class changes an admin made since this browser last signed in.
    refreshUser()
    if (user?.role !== 'superadmin') fetchSettings()
    // Registers taken without network go out as soon as the phone is online again.
    const send = () => syncRegisters().then((r) => {
      if (r.sent) toast.success(`${r.sent} register(s) taken offline have been sent.`)
      r.failed.forEach((f) => toast.error(`Register for ${f.className} was not accepted: ${f.error}`, { duration: 8000 }))
    }).catch(() => {})
    send()
    window.addEventListener('online', send)
    return () => window.removeEventListener('online', send)
  }, [])

  const sub = user?.subscription
  const showSubBanner = sub && ['admin', 'head'].includes(user?.role) &&
    (sub.status !== 'active' || (sub.daysLeft != null && sub.daysLeft <= 7))

  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  // Clear the school's data too, so the next person on this computer never sees it.
  const handleLogout = () => {
    const wasParent = user?.role === 'parent'
    logout(); resetSchool(); navigate(wasParent ? '/parent-login' : '/login')
  }
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
              {logoUrl && user?.role !== 'superadmin' ? (
                <img src={logoUrl} alt={`${settings?.schoolName || 'School'} logo`}
                  className="w-9 h-9 rounded-lg object-contain bg-white border border-border p-0.5" />
              ) : (
                <div className="w-8 h-8 bg-blue rounded-lg flex items-center justify-center">
                  <Shield className="w-4 h-4 text-white" />
                </div>
              )}
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
            {showSubBanner && (
              <div className={clsx('no-print mb-4 px-4 py-3 rounded-xl text-[13px] border flex flex-wrap items-center justify-between gap-2',
                sub.status === 'locked' ? 'bg-red-light text-[#A32D2D] border-[#F09595]' : 'bg-amber-light text-amber border-[#FAC775]')}>
                <span>
                  {sub.status === 'locked' && 'Your subscription has ended: the school is read-only (you can still view and print).'}
                  {sub.status === 'grace' && 'Your subscription has ended. Everything still works for a few more days — please renew.'}
                  {sub.status === 'active' && `Your ${sub.daysLeft <= 0 ? 'plan ends today' : `plan ends in ${sub.daysLeft} day(s)`}.`}
                </span>
                <Link to="/billing" className="font-bold underline">Go to Billing</Link>
              </div>
            )}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
