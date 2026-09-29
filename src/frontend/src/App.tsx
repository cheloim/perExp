import { useState, useEffect, lazy, Suspense } from "react";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import useSeoMeta from "./hooks/useSeoMeta";
import AIAssistant from "./components/AIAssistant";
import InvestmentsAssistant from "./components/InvestmentsAssistant";
import UserPanel from "./components/UserPanel";
import NotificationsPanel from "./components/NotificationsPanel";
import { UploadProgressProvider } from "./context/UploadProgressContext";
import { NotificationsProvider, useNotifications } from "./context/NotificationsContext";
import { getStoredToken, getMe, getAdminSlug, dismissWhatsNew, createExpense } from "./api/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useUndoToast } from "./hooks/useUndoToast";
import ImpersonationBanner from "./components/ImpersonationBanner";
import ReAuthModal from "./components/ReAuthModal";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  isTelegramWebApp,
  initTelegramWebApp,
  telegramAutoLogin,
  isLikelyTelegram,
} from "./services/telegramWebApp";
import { ExpenseModal } from "./components/ExpenseModals";
import QuickViewLayout from "./layouts/QuickViewLayout";
import Sidebar from "./components/Sidebar";
import MobileNav from "./components/MobileNav";
import MobileHeader from "./components/MobileHeader";
import SpeedDial from "./components/SpeedDial";
import InstitutionalRoutes from "./pages/InstitutionalRoutes";
import type { ExpenseCreate } from "./types";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const ClasificacionPage = lazy(() => import("./pages/ClasificacionPage"));
const ExpensesPage = lazy(() => import("./pages/ExpensesPage"));
const ImportJobPreview = lazy(() => import("./pages/ImportJobPreview"));
const CategoryDashboard = lazy(() => import("./pages/CategoryDashboard"));
const BudgetPage = lazy(() => import("./pages/BudgetPage"));
const InstallmentsPage = lazy(() => import("./pages/InstallmentsPage"));
const InvestmentsPage = lazy(() => import("./pages/InvestmentsPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const OAuthCallbackPage = lazy(() => import("./pages/OAuthCallbackPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const OnboardingWalkthrough = lazy(() => import("./components/OnboardingWalkthrough"));
const WhatsNewModal = lazy(() => import("./components/WhatsNewModal"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const ChangesPage = lazy(() => import("./pages/ChangesPage"));
const GuidePage = lazy(() => import("./pages/GuidePage"));
import { LATEST_VERSION } from "./data/changes";

const TABS = [
  { path: "/", label: "Inicio", icon: "home", exact: true, tour: "sidebar-home" },
  { path: "/expenses", label: "Gastos", icon: "expenses", exact: false, tour: "sidebar-expenses" },
  { path: "/cat-dashboard", label: "Categorías", icon: "catDashboard", exact: false },
  { path: "/budget", label: "Presupuesto", icon: "chartBar", exact: false, tour: "sidebar-budget" },
  {
    path: "/installments",
    label: "Programados",
    icon: "installments",
    exact: false,
    tour: "sidebar-programados",
  },
  { path: "/investments", label: "Inversiones", icon: "investments", exact: false },
  {
    path: "/clasificacion",
    label: "Clasificación",
    icon: "tags",
    exact: false,
    tour: "sidebar-clasificacion",
  },
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
  const [telegramReady, setTelegramReady] = useState(false);
  const [quickView, setQuickView] = useState(false);

  useSeoMeta();

  // Telegram Mini App init + auto-login (runs once)
  // Waits for the async SDK script to load before deciding
  useEffect(() => {
    // If SDK is already present (sync script), resolve immediately
    if (isTelegramWebApp()) {
      setQuickView(true);
      initTelegramWebApp();
      telegramAutoLogin().finally(() => setTelegramReady(true));
      return;
    }

    // Fast check: if we're not likely in Telegram, don't wait
    if (!isLikelyTelegram()) {
      setTelegramReady(true);
      return;
    }

    // We think we're in Telegram but SDK hasn't loaded yet — wait for it
    let resolved = false;
    const resolve = () => {
      if (resolved) return;
      resolved = true;
      if (isTelegramWebApp()) {
        setQuickView(true);
        initTelegramWebApp();
        telegramAutoLogin().finally(() => setTelegramReady(true));
      } else {
        setTelegramReady(true);
      }
    };

    // Poll for SDK availability
    const interval = setInterval(() => {
      if (window.Telegram?.WebApp) {
        clearInterval(interval);
        resolve();
      }
    }, 50);

    // Timeout: if SDK doesn't load in 3s, assume not in Telegram
    const timeout = setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, 3000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);

  // Institutional site: oikonomia.ar / www.oikonomia.ar
  if (hostname === "oikonomia.ar" || hostname === "www.oikonomia.ar") {
    return <InstitutionalRoutes />;
  }

  // App: platform.oikonomia.ar (or localhost)
  if (location.pathname === "/login" || location.pathname === "/register") {
    if (getStoredToken()) return <Navigate to="/" replace />;
    return <LoginPage />;
  }

  if (location.pathname === "/privacy") {
    return (
      <Suspense>
        <PrivacyPage />
      </Suspense>
    );
  }

  if (location.pathname === "/tos") {
    return (
      <Suspense>
        <TermsPage />
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

  if (!telegramReady) return null;

  // In Telegram MiniApp: always show QuickView, even without token
  // (QuickViewLayout handles its own login prompt for unauthenticated users)
  if (isTelegramWebApp() && quickView) {
    return <QuickViewLayout onSwitchToFull={() => setQuickView(false)} />;
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
  const queryClient = useQueryClient();
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [showReAuth, setShowReAuth] = useState(false);
  const [newExpenseOpen, setNewExpenseOpen] = useState(false);
  const { ToastContainer } = useUndoToast();

  // Global expense creation
  const createMut = useMutation({
    mutationFn: (data: ExpenseCreate) => createExpense(data),
    onSuccess: () => {
      setNewExpenseOpen(false);
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  // Global event: open new expense from FAB
  useEffect(() => {
    const handler = () => setNewExpenseOpen(true);
    window.addEventListener("open-new-expense", handler);
    return () => window.removeEventListener("open-new-expense", handler);
  }, []);

  // Get current user for admin check
  const { data: currentUser } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    staleTime: 60000,
  });

  // Get admin slug
  const { data: slugData } = useQuery({
    queryKey: ["admin-slug"],
    queryFn: getAdminSlug,
    enabled: !!currentUser?.is_admin,
    staleTime: 300000,
  });

  // Impersonation state
  const [impersonationSession, setImpersonationSession] = useState<{
    sessionId: number;
    targetUserName: string;
    expiresAt: string;
  } | null>(null);

  // Check for active impersonation on mount
  useEffect(() => {
    const sessionId = sessionStorage.getItem("impersonation_session_id");
    const targetName = sessionStorage.getItem("impersonation_target_name");
    const expiresAt = sessionStorage.getItem("impersonation_expires_at");
    if (sessionId && targetName) {
      setImpersonationSession({
        sessionId: Number(sessionId),
        targetUserName: targetName,
        expiresAt: expiresAt || "",
      });
    }
  }, []);

  // Listen for admin reauth events
  useEffect(() => {
    const handler = () => setShowReAuth(true);
    window.addEventListener("admin-reauth-required", handler);
    return () => window.removeEventListener("admin-reauth-required", handler);
  }, []);

  // Check if we should show What's New modal (only on /)
  useEffect(() => {
    const checkWhatsNew = async () => {
      try {
        if (location.pathname !== "/") return;
        const { SHOW_WHATS_NEW } = await import("./components/WhatsNewModal");
        if (!SHOW_WHATS_NEW) return;
        if (currentUser && !currentUser.onboarding_completed) return;
        const dontRemindLocal = localStorage.getItem("whats_new_dont_remind_version");
        if (dontRemindLocal === LATEST_VERSION) return;
        if (currentUser?.whats_new_dismissed_version === LATEST_VERSION) {
          localStorage.setItem("whats_new_dont_remind_version", LATEST_VERSION);
          return;
        }
        setTimeout(() => setShowWhatsNew(true), 1500);
      } catch {
        // Ignore errors
      }
    };
    checkWhatsNew();
  }, [location.pathname, currentUser]);

  // Scroll to top on navigation
  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTo(0, 0);
  }, [location.pathname]);

  const panelWidth = 360;
  const isCollapsed = true;
  const { unreadCount } = useNotifications();

  // Global Escape key handler
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

  // Listen for open-user-panel event from Dashboard MFA banner
  useEffect(() => {
    const handleOpenUserPanel = () => setUserPanelOpen(true);
    window.addEventListener("open-user-panel", handleOpenUserPanel);
    return () => window.removeEventListener("open-user-panel", handleOpenUserPanel);
  }, []);

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

  // VirtualKeyboard API
  useEffect(() => {
    if ("virtualKeyboard" in navigator) {
      (
        navigator as unknown as {
          virtualKeyboard: { overlaysContent: boolean };
        }
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
      <div className="flex h-screen overflow-hidden bg-base">
        {/* Sidebar — GNOME Adwaita NavigationSplitView pattern */}
        <Sidebar
          tabs={TABS}
          currentUser={currentUser}
          adminSlug={slugData?.slug}
          unreadCount={unreadCount}
          onOpenNotifications={() => setNotifOpen((v) => !v)}
          onOpenUserPanel={() => setUserPanelOpen(true)}
        />

        {/* Main content */}
        <div
          className={`md:pl-16 pb-14 flex-1 flex flex-col min-w-0 overflow-hidden relative transition-all duration-300 ${
            isInvestments ? (isCollapsed ? "mr-0" : `mr-0 sm:mr-[${panelWidth}px]`) : "mr-0"
          }`}
          style={isInvestments && !isCollapsed ? { marginRight: panelWidth } : undefined}
        >
          {/* Mobile header — Adwaita HeaderBar with actions */}
          <MobileHeader
            unreadCount={unreadCount}
            onOpenNotifications={() => setNotifOpen((v) => !v)}
            onOpenUserPanel={() => setUserPanelOpen(true)}
          />

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
                    <div className="flex items-center justify-center h-full" role="status">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                      <span className="sr-only">Cargando…</span>
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
                      path="/clasificacion"
                      element={
                        <RequireAuth>
                          <ClasificacionPage />
                        </RequireAuth>
                      }
                    />
                    <Route path="/tags" element={<Navigate to="/clasificacion" replace />} />
                    <Route path="/categories" element={<Navigate to="/clasificacion" replace />} />
                    <Route
                      path="/categories/:id"
                      element={<Navigate to="/clasificacion" replace />}
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
                      path="/budget"
                      element={
                        <RequireAuth>
                          <BudgetPage />
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
                      path="/x/:slug"
                      element={
                        <RequireAuth>
                          <AdminPage />
                        </RequireAuth>
                      }
                    />
                    <Route path="/guide" element={<GuidePage />} />
                    <Route path="/guide/budgeting" element={<GuidePage />} />
                    <Route path="/guide/smart-import" element={<GuidePage />} />
                    <Route path="/guide/telegram-bot" element={<GuidePage />} />
                    <Route path="/guide/ai-analysis" element={<GuidePage />} />
                    <Route path="/guide/family-groups" element={<GuidePage />} />
                    <Route path="/guide/investments" element={<GuidePage />} />
                    <Route path="/guide/categories" element={<GuidePage />} />
                    <Route path="/guide/recurring" element={<GuidePage />} />
                    <Route path="/changes" element={<ChangesPage />} />
                    <Route path="/changes/:version" element={<ChangesPage />} />
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

          {/* What's New Modal */}
          {showWhatsNew && (
            <Suspense fallback={null}>
              <WhatsNewModal
                onClose={(dontRemind) => {
                  setShowWhatsNew(false);
                  if (dontRemind) {
                    dismissWhatsNew(LATEST_VERSION)
                      .then(() => {
                        localStorage.setItem("whats_new_dont_remind_version", LATEST_VERSION);
                        queryClient.invalidateQueries({ queryKey: ["me"] });
                      })
                      .catch(() => {});
                  }
                }}
              />
            </Suspense>
          )}

          {/* Mobile bottom nav — Adwaita ViewSwitcherBar */}
          <MobileNav
            tabs={TABS}
            showMore={showMoreNav}
            onToggleMore={setShowMoreNav}
            onOpenUserPanel={() => setUserPanelOpen(true)}
          />

          {/* FABs and Speed Dial */}
          <SpeedDial
            isInvestments={isInvestments}
            aiDrawerOpen={aiDrawerOpen}
            newExpenseOpen={newExpenseOpen}
            onOpenAI={() => toggleDrawer(true)}
            onOpenNewExpense={() => setNewExpenseOpen(true)}
          />

          {!isInvestments && (
            <AIAssistant open={aiDrawerOpen} onToggle={() => toggleDrawer(!aiDrawerOpen)} />
          )}
          {isInvestments && <InvestmentsAssistant />}
        </div>

        <UserPanel open={userPanelOpen} onClose={() => setUserPanelOpen(false)} />
        {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} />}

        {/* Impersonation Banner */}
        {impersonationSession && (
          <ImpersonationBanner
            sessionId={impersonationSession.sessionId}
            targetUserName={impersonationSession.targetUserName}
            expiresAt={impersonationSession.expiresAt}
            onEnd={() => setImpersonationSession(null)}
          />
        )}

        {/* ReAuth Modal */}
        {showReAuth && (
          <ReAuthModal
            onAuthenticated={() => setShowReAuth(false)}
            onCancel={() => {
              setShowReAuth(false);
              window.location.href = "/";
            }}
          />
        )}

        {/* Global New Expense Modal */}
        {newExpenseOpen && (
          <ExpenseModal
            initial={null}
            onClose={() => setNewExpenseOpen(false)}
            onSave={(data) => createMut.mutate(data)}
            saveError={createMut.error?.message || null}
            isSaving={createMut.isPending}
          />
        )}
      </div>
      {/* Onboarding */}
      <Suspense fallback={null}>
        <OnboardingWalkthrough onOpenPanel={setUserPanelOpen} />
      </Suspense>
      {ToastContainer}
    </UploadProgressProvider>
  );
}
