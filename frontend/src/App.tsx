import { useState } from 'react'
import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom'
import AIAssistant from './components/AIAssistant'
import InvestmentsAssistant from './components/InvestmentsAssistant'
import Dashboard from './pages/Dashboard'
import CreditCardsPage from './pages/CreditCardsPage'
import ExpensesPage from './pages/ExpensesPage'
import ImportPage from './pages/ImportPage'
import CategoriesPage from './pages/CategoriesPage'
import CategoryDashboard from './pages/CategoryDashboard'
import InstallmentsPage from './pages/InstallmentsPage'
import InvestmentsPage from './pages/InvestmentsPage'
import LoginPage from './pages/LoginPage'
import { getStoredToken } from './api/client'

const TABS = [
  { path: '/',               label: 'Inicio',             icon: '🏠', exact: true },
  { path: '/credit-cards',   label: 'Tarjetas',           icon: '💳', exact: false },
  { path: '/expenses',       label: 'Gastos',             icon: '📋', exact: false },
  { path: '/cat-dashboard',  label: 'Por Categoría',      icon: '🏷️', exact: false },
  { path: '/installments',   label: 'Gasto en cuotas',    icon: '🔄', exact: false },
  { path: '/investments',    label: 'Inversiones',        icon: '📈', exact: false },
  { path: '/import',         label: 'Importar',           icon: '📂', exact: false },
  { path: '/categories',     label: 'Config. Categorías', icon: '⚙️', exact: false },
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

  const toggleDrawer = (open: boolean) => {
    setAiDrawerOpen(open)
    try {
      localStorage.setItem(AI_DRAWER_STATE_KEY, JSON.stringify(open))
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar — expands on hover via CSS group */}
      <aside className="group flex-shrink-0 bg-sidebar border-r border-zinc-200/80 hidden md:flex flex-col w-16 hover:w-64 transition-all duration-300 ease-in-out overflow-hidden">
        {/* Header */}
        <div className="h-16 flex items-center border-b border-zinc-200/80 px-3 gap-2">
          <div className="flex items-center justify-center w-8 h-8 flex-shrink-0 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white font-bold shadow-neon text-sm">
            A
          </div>
          <span className="text-lg font-bold text-zinc-900 tracking-tight whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
            Financial<span className="text-brand-500"> Planning</span>
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5 scrollbar-none">
          {TABS.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.exact}
              title={tab.label}
              className={({ isActive }) => `
                flex items-center gap-3 px-2.5 py-2.5 text-sm font-medium rounded-xl transition-all duration-200
                ${isActive
                  ? 'bg-brand-50 text-brand-700 border border-brand-200'
                  : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 border border-transparent'
                }
              `}
            >
              <span className="text-lg leading-none flex-shrink-0">{tab.icon}</span>
              <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
                {tab.label}
              </span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden relative transition-all duration-300 ${isInvestments ? 'mr-0 sm:mr-[360px]' : aiDrawerOpen ? 'mr-0 sm:mr-[380px]' : 'mr-0'}`}>
        {/* Mobile header */}
        <header className="md:hidden h-14 border-b border-zinc-200/80 bg-white/90 backdrop-blur-md flex items-center px-4 sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white text-[10px] flex items-center justify-center font-bold">
              A
            </div>
            <span className="font-bold text-zinc-900 tracking-tight">Financial<span className="text-brand-500"> Planning</span></span>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto overflow-x-auto relative z-10">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-8 md:py-10">
            <Routes>
              <Route path="/"               element={<RequireAuth><Dashboard /></RequireAuth>} />
              <Route path="/credit-cards"   element={<RequireAuth><CreditCardsPage /></RequireAuth>} />
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
        <nav className="md:hidden border-t border-zinc-200/80 bg-white/95 backdrop-blur-lg flex items-center justify-around pb-safe pt-1 z-40">
          {TABS.slice(0, 5).map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.exact}
              className={({ isActive }) => `
                flex flex-col items-center gap-1 p-2 min-w-[64px] text-[10px] font-medium transition-colors
                ${isActive ? 'text-brand-600' : 'text-zinc-500 hover:text-zinc-700'}
              `}
            >
              <span className="text-xl mb-0.5">{tab.icon}</span>
              <span className="truncate w-full text-center">{tab.label.split(' ')[0]}</span>
            </NavLink>
          ))}
        </nav>

        {/* Floating AI Assistant toggle button — hidden on /investments */}
        {!aiDrawerOpen && !isInvestments && (
          <button
            onClick={() => toggleDrawer(true)}
            className="fixed top-4 md:top-6 right-4 md:right-6 z-50 flex items-center justify-center w-11 h-11 bg-brand-600 hover:bg-brand-500 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-300"
            title="Abrir asistente IA"
          >
            <span className="text-xl">✨</span>
          </button>
        )}

        {!isInvestments && <AIAssistant open={aiDrawerOpen} onToggle={() => toggleDrawer(!aiDrawerOpen)} />}
        {isInvestments && <InvestmentsAssistant />}
      </div>
    </div>
  )
}
