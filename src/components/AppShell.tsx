import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Sparkles,
  Kanban,
  Plus,
  LogOut,
  Menu,
  X,
  User,
  Search,
} from 'lucide-react'
import { useAuth } from '../context/useAuth'

const navigation = [
  {
    to: '/app/profile',
    label: 'Overview & Profile',
    icon: LayoutDashboard,
    badge: null,
  },
  {
    to: '/app/jobs/new',
    label: 'Analyse a Job',
    icon: Sparkles,
    badge: 'AI',
  },
  {
    to: '/app/tracker',
    label: 'Application Tracker',
    icon: Kanban,
    badge: null,
  },
  {
    to: '/app/searches',
    label: 'Saved Searches',
    icon: Search,
    badge: null,
  },
]

export default function AppShell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleSignOut() {
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  // Get current page title for breadcrumb
  const currentTitle =
    navigation.find((item) =>
      item.to === '/app/jobs/new'
        ? location.pathname.startsWith('/app/jobs')
        : location.pathname === item.to,
    )?.label ?? (location.pathname.startsWith('/app/jobs/') ? 'Job Match & Decision' : 'Workspace')

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 font-sans antialiased">
      {/* Mobile Backdrop */}
      {menuOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs transition-opacity lg:hidden"
        />
      )}

      {/* Sidebar Navigation */}
      <aside
        id="sidebar-navigation"
        aria-label="Sidebar navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-slate-950 px-5 py-6 text-white shadow-2xl transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Logo & Tagline */}
        <div className="flex items-center justify-between px-2">
          <NavLink
            to="/app/profile"
            className="group flex items-center gap-3"
            onClick={() => setMenuOpen(false)}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-black text-xl shadow-lg shadow-blue-500/30 group-hover:scale-105 transition-transform">
              K
            </div>
            <div>
              <span className="block text-base font-bold tracking-tight text-white">
                KariyalyAI
              </span>
              <span className="block text-xs font-medium text-slate-400">
                Career, clarified.
              </span>
            </div>
          </NavLink>

          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action Button */}
        <div className="mt-8 px-2">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              navigate('/app/jobs/new')
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition-all hover:bg-blue-700 active:scale-[0.99] cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Analyse New Job</span>
          </button>
        </div>

        {/* Section Heading */}
        <div className="mt-8 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Workspace Navigation
        </div>

        {/* Navigation Links */}
        <nav aria-label="Primary navigation" className="mt-2.5 space-y-1.5">
          {navigation.map((item) => {
            const Icon = item.icon
            const isMatchRoute =
              item.to === '/app/jobs/new' && location.pathname.startsWith('/app/jobs')
            const isActive = location.pathname === item.to || isMatchRoute

            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className={`group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-blue-600/15 text-blue-400 font-semibold ring-1 ring-blue-500/30'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`h-4.5 w-4.5 transition-colors ${
                      isActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="rounded-md bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-300">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Guidance Callout */}
        <div className="mt-auto rounded-xl border border-slate-800/80 bg-slate-900/60 p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>AI Verification Rule</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
            All AI outputs carry the standard <span className="text-slate-300 font-mono text-[11px]">AI-generated, please verify</span> tag.
          </p>
        </div>

        {/* User Card & Signout */}
        <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/40 p-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 font-semibold text-xs text-white">
              {user?.email?.charAt(0).toUpperCase() ?? 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-slate-200">
                {user?.email}
              </span>
              <span className="block text-[10px] text-slate-400">
                Standard Account
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void handleSignOut()}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="min-h-screen lg:pl-72 flex flex-col">
        {/* Sticky Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 sm:px-6 lg:px-8 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="sidebar-navigation"
              onClick={() => setMenuOpen(true)}
              className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:hidden cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-slate-900">{currentTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <NavLink
              to="/onboarding"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
            >
              <User className="h-3.5 w-3.5 text-slate-500" />
              <span>Update CV / Profile</span>
            </NavLink>

            <button
              type="button"
              onClick={() => navigate('/app/jobs/new')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Analyse Job</span>
            </button>
          </div>
        </header>

        {/* Page Container */}
        <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
