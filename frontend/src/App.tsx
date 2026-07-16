import { useState, useEffect, lazy, Suspense } from "react";
import { Routes, Route, NavLink, useLocation, Navigate } from "react-router-dom";
import AIAssistant from "./components/AIAssistant";
import InvestmentsAssistant from "./components/InvestmentsAssistant";
import UserPanel from "./components/UserPanel";
import { APP_NAME } from "./config";
import NotificationsPanel from "./components/NotificationsPanel";
import ImportUploadButton from "./components/ImportUploadButton";
import { usePanelWidth } from "./context/PanelWidthContext";
import { UploadProgressProvider } from "./context/UploadProgressContext";
import { NotificationsProvider, useNotifications } from "./context/NotificationsContext";
import { FamilyGroupProvider } from "./context/FamilyGroupContext";
import { sidebarIcons } from "./components/SidebarIcons";
import { getStoredToken } from "./api/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useUndoToast } from "./hooks/useUndoToast";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const AccountsPage = lazy(() => import("./pages/AccountsPage"));
const ExpensesPage = lazy(() => import("./pages/ExpensesPage"));
const ImportJobPreview = lazy(() => import("./pages/ImportJobPreview"));
const CategoriesPage = lazy(() => import("./pages/CategoriesPage"));
const CategoryDashboard = lazy(() => import("./pages/CategoryDashboard"));
const InstallmentsPage = lazy(() => import("./pages/InstallmentsPage"));
const InvestmentsPage = lazy(() => import("./pages/InvestmentsPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const OAuthCallbackPage = lazy(() => import("./pages/OAuthCallbackPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const GuidePage = lazy(() => import("./pages/GuidePage"));
const OnboardingWalkthrough = lazy(() => import("./components/OnboardingWalkthrough"));

const TABS = [
  { path: "/", label: "Inicio", icon: "home", exact: true, tour: "sidebar-home" },
  { path: "/accounts", label: "Cuentas", icon: "accounts", exact: false, tour: "sidebar-accounts" },
  { path: "/expenses", label: "Gastos", icon: "expenses", exact: false, tour: "sidebar-expenses" },
  { path: "/cat-dashboard", label: "Categorías", icon: "catDashboard", exact: false },
  { path: "/installments", label: "Cuotas", icon: "installments", exact: false },
  { path: "/investments", label: "Inversiones", icon: "investments", exact: false },
  { path: "/categories", label: "Config. Categorías", icon: "settings", exact: false },
  { path: "/guide", label: "Guía", icon: "guide", exact: true, tour: "sidebar-guide" },
];

const AI_DRAWER_STATE_KEY = "ai_drawer_open";

function getInitialDrawerState(): boolean {
  try {
    const saved = localStorage.getItem(AI_DRAWER_STATE_KEY);
    return saved ? JSON.parse(saved) : false;
  } catch {
    return false;
  }
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getStoredToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const location = useLocation();
  const hostname = window.location.hostname;

  // Institutional site: oikonomia.ar / www.oikonomia.ar
  if (hostname === "oikonomia.ar" || hostname === "www.oikonomia.ar") {
    if (location.pathname === "/privacy") {
      return (
        <Suspense>
          <PrivacyPage />
        </Suspense>
      );
    }
    return (
      <Suspense>
        <LandingPage />
      </Suspense>
    );
  }

  // App: platform.oikonomia.ar (or localhost)
  if (location.pathname === "/login") return <LoginPage />;

  if (location.pathname === "/privacy") {
    return (
      <Suspense>
        <PrivacyPage />
      </Suspense>
    );
  }

  if (location.pathname === "/reset-password") return <ResetPasswordPage />;

  if (location.pathname === "/oauth/callback") {
    return (
      <Suspense>
        <OAuthCallbackPage />
      </Suspense>
    );
  }

  if (!getStoredToken()) return <Navigate to="/login" replace />;

  return (
    <NotificationsProvider>
      <MainLayout />
    </NotificationsProvider>
  );
}

function MainLayout() {
  const location = useLocation();
  const isInvestments = location.pathname === "/investments";
  const [aiDrawerOpen, setAiDrawerOpen] = useState(getInitialDrawerState);
  const [userPanelOpen, setUserPanelOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [showMoreNav, setShowMoreNav] = useState(false);
  const { ToastContainer } = useUndoToast();

  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTo(0, 0);
  }, [location.pathname]);
  const { panelWidth, isCollapsed } = usePanelWidth();
  const { unreadCount } = useNotifications();

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (aiDrawerOpen) setAiDrawerOpen(false);
        if (userPanelOpen) setUserPanelOpen(false);
        if (notifOpen) setNotifOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [aiDrawerOpen, userPanelOpen, notifOpen]);

  // Global viewport tracking for Firefox bottom bar and mobile keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      document.documentElement.style.setProperty(
        "--browser-bottom-inset",
        `${Math.max(0, inset)}px`,
      );
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // VirtualKeyboard API — overlay keyboard instead of resizing viewport
  useEffect(() => {
    if ("virtualKeyboard" in navigator) {
      (
        navigator as unknown as { virtualKeyboard: { overlaysContent: boolean } }
      ).virtualKeyboard.overlaysContent = true;
    }
  }, []);

  const toggleDrawer = (open: boolean) => {
    setAiDrawerOpen(open);
    try {
      localStorage.setItem(AI_DRAWER_STATE_KEY, JSON.stringify(open));
    } catch {
      // ignore
    }
  };

  return (
    <UploadProgressProvider>
      <FamilyGroupProvider>
        <div className="flex h-screen overflow-hidden bg-base">
          {/* Sidebar — GNOME Adwaita style, expand/collapse on hover */}
          <aside className="group fixed left-0 top-0 h-full z-30 bg-sidebar border-r border-[var(--border-color)] hidden md:flex flex-col w-16 hover:w-[220px] transition-all duration-300 overflow-hidden">
            {/* Header */}
            <div className="h-14 flex items-center border-b border-[var(--border-color)] px-3 gap-3">
              <div className="w-8 h-8 flex-shrink-0 rounded-md bg-primary flex items-center justify-center text-white font-bold text-xs font-semibold">
                A
              </div>
              <span className="text-sm font-semibold text-[var(--color-on-sidebar)] whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 tracking-tight">
                {APP_NAME}
              </span>
            </div>

            {/* Nav links — GNOME style */}
            <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5 scrollbar-none">
              {TABS.filter((tab) => tab.path !== "/categories").map((tab) => (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  end={tab.exact}
                  title={tab.label}
                  data-tour={tab.tour}
                  className={({ isActive }) => `
                group/nav relative flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium transition-all duration-150
                ${
                  isActive
                    ? "bg-[var(--color-base-alt)] text-[var(--color-sidebar-text-active)]"
                    : "text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)]"
                }
              `}
                >
                  {({ isActive }) => (
                    <>
                      {/* Active indicator bar — GNOME style */}
                      <span
                        className={`absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-full bg-sidebar-indicator transition-opacity duration-150 ${
                          isActive ? "opacity-100" : "opacity-0"
                        } group-hover/nav:opacity-30`}
                      />

                      <span
                        className={`w-5 h-5 flex-shrink-0 flex items-center justify-center ${
                          isActive ? "text-[var(--color-sidebar-icon-active)]" : ""
                        }`}
                      >
                        {sidebarIcons[tab.icon as keyof typeof sidebarIcons]}
                      </span>
                      <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
                        {tab.label}
                      </span>
                    </>
                  )}
                </NavLink>
              ))}
              <div className="border-t border-[var(--border-color)] mx-2 my-1" />
              {(() => {
                const settingsTab = TABS.find((t) => t.path === "/categories");
                if (!settingsTab) return null;
                return (
                  <NavLink
                    key={settingsTab.path}
                    to={settingsTab.path}
                    end={settingsTab.exact}
                    title={settingsTab.label}
                    className={({ isActive }) => `
                  group/nav relative flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium transition-all duration-150
                  ${
                    isActive
                      ? "bg-[var(--color-base-alt)] text-[var(--color-sidebar-text-active)]"
                      : "text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)]"
                  }
                `}
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={`absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-full bg-sidebar-indicator transition-opacity duration-150 ${
                            isActive ? "opacity-100" : "opacity-0"
                          } group-hover/nav:opacity-30`}
                        />
                        <span
                          className={`w-5 h-5 flex-shrink-0 flex items-center justify-center ${
                            isActive ? "text-[var(--color-sidebar-icon-active)]" : ""
                          }`}
                        >
                          {sidebarIcons[settingsTab.icon as keyof typeof sidebarIcons]}
                        </span>
                        <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
                          {settingsTab.label}
                        </span>
                      </>
                    )}
                  </NavLink>
                );
              })()}
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
                      <span className="absolute -top-1.5 -right-1.5 bg-[#ed333b] text-white text-[10px] font-semibold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5 animate-pulse">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </span>
                  <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
                    Notificaciones
                  </span>
                </button>
              </div>

              {/* Import Upload Button */}
              <ImportUploadButton />

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
          <div
            className={`md:pl-16 pb-14 flex-1 flex flex-col min-w-0 overflow-hidden relative transition-all duration-300 ${
              isInvestments ? (isCollapsed ? "mr-0" : `mr-0 sm:mr-[${panelWidth}px]`) : "mr-0"
            }`}
            style={isInvestments && !isCollapsed ? { marginRight: panelWidth } : undefined}
          >
            {/* Mobile header */}
            <header className="md:hidden h-14 border-b border-[var(--border-color)] bg-sidebar flex items-center px-4 sticky top-0 z-40">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center text-white text-[11px] font-bold">
                  A
                </div>
                <span className="font-semibold text-[var(--color-on-sidebar)] tracking-tight">
                  {APP_NAME}
                </span>
              </div>
            </header>

            {/* Scrollable content */}
            <main className="flex-1 overflow-y-auto overflow-x-auto relative z-10">
              <div
                className={`w-full px-4 sm:px-6 lg:px-8 ${
                  location.pathname.startsWith("/import-jobs") ? "py-0" : "py-8 md:py-10"
                }`}
              >
                <ErrorBoundary>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center h-full">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                      </div>
                    }
                  >
                    <Routes>
                      <Route path="/login" element={<LoginPage />} />
                      <Route
                        path="/"
                        element={
                          <RequireAuth>
                            <Dashboard />
                          </RequireAuth>
                        }
                      />
                      <Route
                        path="/accounts"
                        element={
                          <RequireAuth>
                            <AccountsPage />
                          </RequireAuth>
                        }
                      />
                      <Route
                        path="/expenses"
                        element={
                          <RequireAuth>
                            <ExpensesPage />
                          </RequireAuth>
                        }
                      />
                      <Route
                        path="/cat-dashboard"
                        element={
                          <RequireAuth>
                            <CategoryDashboard />
                          </RequireAuth>
                        }
                      />
                      <Route
                        path="/installments"
                        element={
                          <RequireAuth>
                            <InstallmentsPage />
                          </RequireAuth>
                        }
                      />
                      <Route
                        path="/investments"
                        element={
                          <RequireAuth>
                            <InvestmentsPage />
                          </RequireAuth>
                        }
                      />
                      <Route
                        path="/import-jobs/:jobId"
                        element={
                          <RequireAuth>
                            <ImportJobPreview />
                          </RequireAuth>
                        }
                      />
                      <Route
                        path="/categories"
                        element={
                          <RequireAuth>
                            <CategoriesPage />
                          </RequireAuth>
                        }
                      />
                      <Route
                        path="/categories/:id"
                        element={
                          <RequireAuth>
                            <CategoriesPage />
                          </RequireAuth>
                        }
                      />
                      <Route
                        path="/guide"
                        element={
                          <RequireAuth>
                            <GuidePage />
                          </RequireAuth>
                        }
                      />
                      <Route
                        path="*"
                        element={
                          <RequireAuth>
                            <Dashboard />
                          </RequireAuth>
                        }
                      />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </div>
            </main>

            {/* Mobile bottom nav */}
            <nav className="md:hidden border-t border-[var(--border-color)] bg-sidebar flex items-center justify-around pb-safe pt-1 z-40 fixed inset-x-0 bottom-0 translate-y-[var(--browser-bottom-inset)]">
              {TABS.slice(0, 4).map((tab) => (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  end={tab.exact}
                  className={({ isActive }) => `
                flex flex-col items-center gap-1 p-2 min-w-[64px] text-[10px] font-medium transition-colors
                ${isActive ? "text-primary" : "text-[var(--color-sidebar-icon)]"}
              `}
                >
                  <span className="w-5 h-5 mb-0.5">
                    {sidebarIcons[tab.icon as keyof typeof sidebarIcons]}
                  </span>
                  <span className="truncate w-full text-center">{tab.label.split(" ")[0]}</span>
                </NavLink>
              ))}
              <button
                onClick={() => setShowMoreNav(!showMoreNav)}
                className="flex flex-col items-center gap-1 p-2 min-w-[64px] text-[10px] font-medium transition-colors text-[var(--color-sidebar-icon)]"
              >
                <span className="w-5 h-5 mb-0.5">{sidebarIcons.more}</span>
                <span className="truncate w-full text-center">Más</span>
              </button>
              {showMoreNav && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowMoreNav(false)} />
                  <div className="absolute bottom-full right-2 mb-2 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-lg py-2 min-w-[180px] z-40">
                    {/* User account button */}
                    <button
                      onClick={() => {
                        setShowMoreNav(false);
                        setUserPanelOpen(true);
                      }}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--color-base-alt)] transition-colors w-full"
                    >
                      <span className="w-5 h-5">{sidebarIcons.user}</span>
                      <span>Mi cuenta</span>
                    </button>
                    <div className="border-t border-[var(--border-color)] my-1" />
                    {TABS.slice(4).map((tab) => (
                      <NavLink
                        key={tab.path}
                        to={tab.path}
                        end={tab.exact}
                        onClick={() => setShowMoreNav(false)}
                        className={({ isActive }) => `
                        flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                        ${
                          isActive
                            ? "text-primary bg-primary/5"
                            : "text-[var(--text-primary)] hover:bg-[var(--color-base-alt)]"
                        }
                      `}
                      >
                        <span className="w-5 h-5">
                          {sidebarIcons[tab.icon as keyof typeof sidebarIcons]}
                        </span>
                        <span>{tab.label}</span>
                      </NavLink>
                    ))}
                  </div>
                </>
              )}
            </nav>

            {/* Floating AI Assistant toggle button */}
            {!aiDrawerOpen && !isInvestments && (
              <button
                onClick={() => toggleDrawer(true)}
                className="fixed bottom-[calc(3.5rem+var(--browser-bottom-inset,0px))] md:bottom-6 right-4 md:right-6 z-50 flex items-center justify-center w-11 h-11 bg-primary hover:brightness-110 text-white rounded-md shadow-gnome hover:shadow-gnome-lg scale-100 hover:scale-105 transition-all duration-150"
                title="Abrir asistente IA"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M10 2l2.5 5 5.5.8-4 3.9.95 5.5L10 14.75l-4.95 2.45.95-5.5-4-3.9 5.5-.8L10 2z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            )}

            {!isInvestments && (
              <AIAssistant open={aiDrawerOpen} onToggle={() => toggleDrawer(!aiDrawerOpen)} />
            )}
            {isInvestments && <InvestmentsAssistant />}
            <Suspense fallback={null}>
              <OnboardingWalkthrough />
            </Suspense>
          </div>

          <UserPanel open={userPanelOpen} onClose={() => setUserPanelOpen(false)} />
          {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} />}
        </div>
      </FamilyGroupProvider>
      {ToastContainer}
    </UploadProgressProvider>
  );
}
