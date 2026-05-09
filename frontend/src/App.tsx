import { useState, useEffect } from 'react'
import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import AIAssistant from './components/AIAssistant'
import InvestmentsAssistant from './components/InvestmentsAssistant'
import UserPanel from './components/UserPanel'
import NotificationsPanel from './components/NotificationsPanel'
import { usePanelWidth } from './context/PanelWidthContext'
import { sidebarIcons } from './components/SidebarIcons'
import Dashboard from './pages/Dashboard'
import AccountsPage from './pages/AccountsPage'
import ExpensesPage from './pages/ExpensesPage'
import ImportPage from './pages/ImportPage'
import CategoriesPage from './pages/CategoriesPage'
import CategoryDashboard from './pages/CategoryDashboard'
import InstallmentsPage from './pages/InstallmentsPage'
import InvestmentsPage from './pages/InvestmentsPage'
import LoginPage from './pages/LoginPage'
import OAuthCallback from './pages/OAuthCallback'
import { getStoredToken, getUnreadCount } from './api/client'

const TABS = [
  { path: '/',               label: 'Inicio',              icon: 'home',        exact: true },
  { path: '/accounts',       label: 'Cuentas',             icon: 'accounts',    exact: false },
  { path: '/expenses',       label: 'Gastos',              icon: 'expenses',    exact: false },
  { path: '/cat-dashboard',  label: 'Por Categoría',        icon: 'catDashboard', exact: false },
  { path: '/installments',   label: 'Gasto en cuotas',      icon: 'installments', exact: false },
  { path: '/investments',    label: 'Inversiones',         icon: 'investments', exact: false },
  { path: '/import',         label: 'Importar',            icon: 'import',      exact: false },
  { path: '/categories',    label: 'Config. Categorías',  icon: 'settings',    exact: false },
]

const AI_DRAWER_STATE_KEY = 'ai_drawer_open'

function getInitialDrawerState(): boolean {
  try {
    const saved = localStorage.getItem(AI_DRAWER_STATE_KEY)
    return saved ? JSON.parse(saved) : false
  } catch {
    return false
  }
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getStoredToken()) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const location = useLocation()

  if (location.pathname === '/login') return <LoginPage />

  if (!getStoredToken()) return <Navigate to="/login" replace />

  const isInvestments = location.pathname === '/investments'
  const [aiDrawerOpen, setAiDrawerOpen] = useState(getInitialDrawerState)
  const [userPanelOpen, setUserPanelOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const { panelWidth, isCollapsed } = usePanelWidth()

  const { data: unreadData } = useQuery({
    queryKey: ['notifications-count'],
    queryFn: getUnreadCount,
    refetchInterval: 30000,
  })
  const unreadCount = unreadData?.count ?? 0

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (aiDrawerOpen) setAiDrawerOpen(false)
        if (userPanelOpen) setUserPanelOpen(false)
        if (notifOpen) setNotifOpen(false)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [aiDrawerOpen, userPanelOpen, notifOpen])

  const toggleDrawer = (open: boolean) => {
    setAiDrawerOpen(open)
    try {
      localStorage.setItem(AI_DRAWER_STATE_KEY, JSON.stringify(open))
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-base">
      {/* Sidebar — GNOME Adwaita style, expand/collapse on hover */}
      <aside className="group flex-shrink-0 bg-sidebar border-r border-[var(--border-color)] hidden md:flex flex-col w-16 hover:w-[220px] transition-all duration-300 overflow-hidden">
        {/* Header */}
        <div className="h-14 flex items-center border-b border-[var(--border-color)] px-3 gap-3">
          <div className="w-8 h-8 flex-shrink-0 rounded-md bg-primary flex items-center justify-center text-white font-bold text-xs font-semibold">
            A
          </div>
          <span className="text-sm font-semibold text-[var(--color-on-sidebar)] whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 tracking-tight">
            Financial Planning
          </span>
        </div>

        {/* Nav links — GNOME style */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5 scrollbar-none">
          {TABS.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.exact}
              title={tab.label}
              className={({ isActive }) => `
                group/nav relative flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium transition-all duration-150
                ${isActive
                  ? 'bg-[var(--color-base-alt)] text-[var(--color-sidebar-text-active)]'
                  : 'text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)]'
                }
              `}
            >
              {({ isActive }) => (
                <>
                  {/* Active indicator bar — GNOME style */}
                  <span className={`absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-full bg-sidebar-indicator transition-opacity duration-150 ${isActive ? 'opacity-100' : 'opacity-0'} group-hover/nav:opacity-30`} />

                  <span className={`w-5 h-5 flex-shrink-0 flex items-center justify-center ${isActive ? 'text-[var(--color-sidebar-icon-active)]' : ''}`}>
                    {sidebarIcons[tab.icon as keyof typeof sidebarIcons]}
                  </span>
                  <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
                    {tab.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="px-2 py-3 border-t border-[var(--border-color)] space-y-0.5">
          {/* Bell */}
          <div className="relative">
            <button
              onClick={() => setNotifOpen((v) => !v)}
              title="Notificaciones"
              className="group/notif relative w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)] transition-all duration-150"
            >
              <span className="relative w-5 h-5 flex-shrink-0 flex items-center justify-center">
                {sidebarIcons.bell}
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-[#ed333b] text-white text-[10px] font-semibold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </span>
              <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
                Notificaciones
              </span>
            </button>
          </div>

          {/* User */}
          <button
            onClick={() => setUserPanelOpen(true)}
            title="Mi cuenta"
            className="group/user w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)] transition-all duration-150"
          >
            <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
              {sidebarIcons.user}
            </span>
            <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
              Mi cuenta
            </span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden relative transition-all duration-300 ${isInvestments ? (isCollapsed ? 'mr-0' : `mr-0 sm:mr-[${panelWidth}px]`) : aiDrawerOpen ? 'mr-0 sm:mr-[380px]' : 'mr-0'}`} style={isInvestments && !isCollapsed ? { marginRight: panelWidth } : undefined}>
        {/* Mobile header */}
        <header className="md:hidden h-14 border-b border-[var(--border-color)] bg-sidebar flex items-center px-4 sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center text-white text-[11px] font-bold">
              A
            </div>
            <span className="font-semibold text-[var(--color-on-sidebar)] tracking-tight">Financial Planning</span>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto overflow-x-auto relative z-10">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-8 md:py-10">
            <Routes>
              <Route path="/login"          element={<LoginPage />} />
              <Route path="/oauth/google/callback" element={<OAuthCallback />} />
              <Route path="/"               element={<RequireAuth><Dashboard /></RequireAuth>} />
              <Route path="/accounts"       element={<RequireAuth><AccountsPage /></RequireAuth>} />
              <Route path="/expenses"       element={<RequireAuth><ExpensesPage /></RequireAuth>} />
              <Route path="/cat-dashboard"  element={<RequireAuth><CategoryDashboard /></RequireAuth>} />
              <Route path="/installments"   element={<RequireAuth><InstallmentsPage /></RequireAuth>} />
              <Route path="/investments"    element={<RequireAuth><InvestmentsPage /></RequireAuth>} />
              <Route path="/import"         element={<RequireAuth><ImportPage /></RequireAuth>} />
              <Route path="/categories"     element={<RequireAuth><CategoriesPage /></RequireAuth>} />
              <Route path="/categories/:id" element={<RequireAuth><CategoriesPage /></RequireAuth>} />
              <Route path="*"               element={<RequireAuth><Dashboard /></RequireAuth>} />
            </Routes>
          </div>
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden border-t border-[var(--border-color)] bg-sidebar flex items-center justify-around pb-safe pt-1 z-40">
          {TABS.slice(0, 5).map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.exact}
              className={({ isActive }) => `
                flex flex-col items-center gap-1 p-2 min-w-[64px] text-[10px] font-medium transition-colors
                ${isActive ? 'text-primary' : 'text-[var(--color-sidebar-icon)]'}
              `}
            >
              <span className="w-5 h-5 mb-0.5">{sidebarIcons[tab.icon as keyof typeof sidebarIcons]}</span>
              <span className="truncate w-full text-center">{tab.label.split(' ')[0]}</span>
            </NavLink>
          ))}
        </nav>

        {/* Floating AI Assistant toggle button */}
        {!aiDrawerOpen && !isInvestments && (
          <button
            onClick={() => toggleDrawer(true)}
            className="fixed bottom-4 md:bottom-6 right-4 md:right-6 z-50 flex items-center justify-center w-10 h-10 bg-primary hover:brightness-110 text-white rounded-md shadow-gnome hover:shadow-gnome-lg scale-100 hover:scale-105 transition-all duration-150"
            title="Abrir asistente IA"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 2l2.5 5 5.5.8-4 3.9.95 5.5L10 14.75l-4.95 2.45.95-5.5-4-3.9 5.5-.8L10 2z" fill="currentColor"/>
            </svg>
          </button>
        )}

        {!isInvestments && <AIAssistant open={aiDrawerOpen} onToggle={() => toggleDrawer(!aiDrawerOpen)} />}
        {isInvestments && <InvestmentsAssistant />}
      </div>

      <UserPanel open={userPanelOpen} onClose={() => setUserPanelOpen(false)} />
      {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} />}
    </div>
  )
}
