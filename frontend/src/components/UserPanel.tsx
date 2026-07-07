import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMe,
  changePassword,
  clearToken,
  getMyGroup,
  inviteToGroup,
  leaveGroup,
  getTelegramKey,
  getTelegramStatus,
  regenerateTelegramKey,
  getMyInviteCode,
  generateInviteCode,
  getSettings,
  putSetting,
  getMonthlyReports,
  generateMonthlyReport,
  downloadReportPdf,
  getMfaStatus,
  setupMfa,
  verifyMfa,
  disableMfa,
} from "../api/client";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "./ConfirmDialog";
import { useTheme } from "../context/ThemeContext";
import AccountsManager from "./AccountsManager";
import CardsManager from "./CardsManager";

const MONTHS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function ReportsTab() {
  const queryClient = useQueryClient();
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  const { data: reportsData, isLoading } = useQuery({
    queryKey: ["monthly-reports"],
    queryFn: getMonthlyReports,
    refetchInterval: (query) => {
      // Refetch every 3s if there are pending reports
      const reports = query.state.data?.reports ?? [];
      const hasPending = reports.some((r) => r.status === "pending" || r.status === "PENDING");
      return hasPending ? 3000 : false;
    },
  });

  const generateMut = useMutation({
    mutationFn: generateMonthlyReport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-reports"] });
      setShowGenerateModal(false);
    },
  });

  // Only show reports that are ready or currently generating
  const allReports = reportsData?.reports ?? [];
  const displayReports = allReports.filter(
    (r) =>
      r.status === "ready" ||
      r.status === "READY" ||
      r.status === "pending" ||
      r.status === "PENDING",
  );

  // Month options for modal — only months NOT yet generated
  const generatedMonths = new Set(
    allReports.filter((r) => r.status === "ready" || r.status === "READY").map((r) => r.month),
  );
  const monthOptions = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    // Skip current month if before 20:00 UTC-3 on last day
    if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const deadlineUTC = new Date(Date.UTC(d.getFullYear(), d.getMonth(), lastDay, 23, 0, 0));
      if (now < deadlineUTC) continue;
    }

    if (!generatedMonths.has(monthStr)) {
      const monthName = MONTHS_ES[d.getMonth()];
      monthOptions.push({
        value: monthStr,
        label: `${monthName} ${d.getFullYear()}`,
      });
    }
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Header */}
      <div className="text-center space-y-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Reportes Mensuales</h3>
        <p className="text-[10px] text-[var(--text-tertiary)]">
          Generá y descargá reportes PDF con el análisis de tus gastos.
        </p>
        <button
          onClick={() => setShowGenerateModal(true)}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition shadow-sm"
        >
          <span className="text-base leading-none">+</span>
          <span>Generar reporte</span>
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-[var(--color-primary)] border-t-transparent" />
        </div>
      ) : displayReports.length === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)] text-center py-8">
          No hay reportes generados. Hacé click en "Generar reporte" para crear uno.
        </p>
      ) : (
        <div className="space-y-2">
          {displayReports.map((r) => {
            const [y, m] = r.month.split("-");
            const monthNum = parseInt(m);
            const monthName = MONTHS_ES[monthNum - 1] || m;
            const isReady = r.status === "ready" || r.status === "READY";

            return (
              <div
                key={r.month}
                className={`p-4 rounded-xl border transition-all ${
                  isReady
                    ? "border-[var(--border-color)] bg-[var(--color-base-container)] hover:bg-[var(--color-base-alt)] cursor-pointer"
                    : "border-[var(--border-color)] bg-[var(--color-base-container)]"
                }`}
                onClick={() => isReady && downloadReportPdf(r.month)}
                role={isReady ? "button" : undefined}
                tabIndex={isReady ? 0 : undefined}
              >
                {isReady ? (
                  <div className="flex items-center justify-center gap-3">
                    <span className="text-lg">📥</span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)] text-center">
                        {monthName} {y}
                      </p>
                      <p className="text-[10px] text-[var(--color-primary)] text-center">
                        Tocá para descargar PDF
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-[var(--text-tertiary)] border-t-transparent" />
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)] text-center">
                        {monthName} {y}
                      </p>
                      <p className="text-[10px] text-[var(--text-tertiary)] text-center">
                        Generando...
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Generate Modal */}
      {showGenerateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => setShowGenerateModal(false)}
        >
          <div
            className="relative bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Generar Reporte</h3>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                Seleccioná el mes para generar el reporte PDF.
              </p>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {monthOptions.length === 0 ? (
                <p className="text-xs text-[var(--text-tertiary)] text-center py-4">
                  Ya tenés reportes para todos los meses disponibles.
                </p>
              ) : (
                monthOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      generateMut.mutate(opt.value);
                    }}
                    disabled={generateMut.isPending}
                    className="w-full text-left px-4 py-3 rounded-lg text-sm border border-[var(--border-color)] hover:bg-[var(--color-base-alt)] text-[var(--text-primary)] transition disabled:opacity-50"
                  >
                    {opt.label}
                  </button>
                ))
              )}
            </div>
            <div className="pt-1">
              <button
                onClick={() => setShowGenerateModal(false)}
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function formatFullName(full_name: string) {
  // stored as "Apellido, Nombre" — display as "Nombre Apellido"
  if (full_name.includes(",")) {
    const [apellido, nombre] = full_name.split(",").map((s) => s.trim());
    return `${nombre} ${apellido}`;
  }
  return full_name;
}

export default function UserPanel({ open, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<"config" | "accounts" | "reports">("config");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [showTelegramKey, setShowTelegramKey] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showRegenInviteConfirm, setShowRegenInviteConfirm] = useState(false);
  const [showRegenTelegramConfirm, setShowRegenTelegramConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // MFA state
  const [mfaQrCode, setMfaQrCode] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSuccess, setMfaSuccess] = useState(false);
  const [showDisableMfa, setShowDisableMfa] = useState(false);
  const [disableMfaCode, setDisableMfaCode] = useState("");
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: open,
  });

  const { data: myGroup, isLoading: isGroupLoading } = useQuery({
    queryKey: ["my-group"],
    queryFn: getMyGroup,
    enabled: open,
  });

  const { data: myInviteCode } = useQuery({
    queryKey: ["my-invite-code"],
    queryFn: getMyInviteCode,
    enabled: open,
  });

  const { data: tgKeyData, refetch: refetchTgKey } = useQuery({
    queryKey: ["telegram-key"],
    queryFn: getTelegramKey,
    enabled: open,
  });

  const { data: tgStatus } = useQuery({
    queryKey: ["telegram-status"],
    queryFn: getTelegramStatus,
    enabled: open,
    refetchInterval: open ? 5000 : false,
  });

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    enabled: open,
  });

  const settingMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => putSetting(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const regenerateKeyMut = useMutation({
    mutationFn: regenerateTelegramKey,
    onSuccess: () => {
      refetchTgKey();
      queryClient.invalidateQueries({ queryKey: ["telegram-status"] });
    },
  });

  const handleCopyKey = () => {
    if (!tgKeyData?.telegram_key) return;
    navigator.clipboard.writeText(tgKeyData.telegram_key);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  const regenerateInviteCodeMut = useMutation({
    mutationFn: generateInviteCode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-invite-code"] });
    },
  });

  const inviteMut = useMutation({
    mutationFn: () => inviteToGroup(inviteCode.trim()),
    onSuccess: () => {
      setInviteSuccess(true);
      setInviteError(null);
      setLeaveError(null);
      setInviteCode("");
      queryClient.invalidateQueries({ queryKey: ["my-group"] });
      // Auto-hide success message after 3 seconds
      setTimeout(() => setInviteSuccess(false), 3000);
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      setInviteError(e?.response?.data?.detail ?? "Error al enviar invitación");
      setInviteSuccess(false);
    },
  });

  const leaveMut = useMutation({
    mutationFn: leaveGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-group"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["card-summary"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["scheduled-summary"] });
      queryClient.invalidateQueries({ queryKey: ["top-merchants"] });
      queryClient.invalidateQueries({ queryKey: ["distinct-values"] });
      queryClient.invalidateQueries({ queryKey: ["credit-card-pasivos"] });
      queryClient.invalidateQueries({ queryKey: ["installments-monthly-load"] });
      setInviteSuccess(false);
      setInviteError(null);
      setLeaveError(null);
      setInviteCode("");
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      setLeaveError(e?.response?.data?.detail ?? "Error al salir del grupo");
    },
  });

  const changePwMut = useMutation({
    mutationFn: () => changePassword(currentPw, newPw),
    onSuccess: () => {
      setPwSuccess(true);
      setPwError(null);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      setPwError(e?.response?.data?.detail ?? "Error al cambiar contraseña");
    },
  });

  const handleChangePw = (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (newPw !== confirmPw) {
      setPwError("Las contraseñas no coinciden");
      return;
    }
    if (newPw.length < 8) {
      setPwError("Mínimo 8 caracteres");
      return;
    }
    if (!/[A-Z]/.test(newPw)) {
      setPwError("Debe contener al menos una mayúscula");
      return;
    }
    if (!/[a-z]/.test(newPw)) {
      setPwError("Debe contener al menos una minúscula");
      return;
    }
    if (!/[0-9]/.test(newPw)) {
      setPwError("Debe contener al menos un número");
      return;
    }
    if (!/[!@#$%^&*()\-_+=<>?/[\]{}|]/.test(newPw)) {
      setPwError("Debe contener al menos un carácter especial (!@#$%^&*...)");
      return;
    }
    changePwMut.mutate();
  };

  // MFA queries and mutations
  const { data: mfaStatus, refetch: refetchMfaStatus } = useQuery({
    queryKey: ["mfa-status"],
    queryFn: getMfaStatus,
    enabled: open,
  });

  const setupMfaMut = useMutation({
    mutationFn: setupMfa,
    onSuccess: (data) => {
      setMfaQrCode(data.qr_code);
      setMfaSecret(data.secret);
      setMfaError(null);
      setMfaSuccess(false);
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      setMfaError(e?.response?.data?.detail ?? "Error al iniciar setup de MFA");
    },
  });

  const verifyMfaMut = useMutation({
    mutationFn: verifyMfa,
    onSuccess: () => {
      setMfaSuccess(true);
      setMfaError(null);
      setMfaQrCode(null);
      setMfaSecret(null);
      setMfaCode("");
      refetchMfaStatus();
      queryClient.invalidateQueries({ queryKey: ["user"] });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      setMfaError(e?.response?.data?.detail ?? "Código MFA incorrecto");
    },
  });

  const disableMfaMut = useMutation({
    mutationFn: disableMfa,
    onSuccess: () => {
      setMfaSuccess(true);
      setMfaError(null);
      setShowDisableMfa(false);
      setDisableMfaCode("");
      refetchMfaStatus();
      queryClient.invalidateQueries({ queryKey: ["user"] });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      setMfaError(e?.response?.data?.detail ?? "Código MFA incorrecto");
    },
  });

  const handleLogout = () => {
    clearToken();
    navigate("/login");
  };

  return (
    <>
      {/* Backdrop */}
      {open && <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />}

      {/* Panel */}
      <div
        className={`fixed left-0 top-0 z-50 h-full w-full sm:w-80 bg-[var(--color-surface)] border-r border-[var(--border-color)] shadow-gnome-lg flex flex-col transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0 pointer-events-auto" : "-translate-x-full pointer-events-none"
        }`}
        style={{ contain: "layout" }}
      >
        {/* Header */}
        <div className="border-b border-border-color">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-base font-semibold text-panel-title">Mi cuenta</h2>
            <button
              onClick={onClose}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              ✕
            </button>
          </div>
          {/* Pill segmented nav */}
          <div className="flex gap-1 p-1 mx-4 mb-1 bg-[var(--color-base-alt)] rounded-lg">
            <button
              onClick={() => setActiveTab("config")}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === "config"
                  ? "bg-[var(--color-surface)] shadow-sm text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Config
            </button>
            <button
              onClick={() => setActiveTab("accounts")}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === "accounts"
                  ? "bg-[var(--color-surface)] shadow-sm text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Cuentas
            </button>
            <button
              onClick={() => setActiveTab("reports")}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === "reports"
                  ? "bg-[var(--color-surface)] shadow-sm text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Reportes
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === "config" && (
            <div className="px-4 py-4 space-y-6">
              {/* User info */}
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                  {user ? formatFullName(user.full_name)[0].toUpperCase() : "?"}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-secondary)] truncate">
                    {user ? formatFullName(user.full_name) : "—"}
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)]">{user?.email ?? "—"}</p>
                </div>
              </div>

              {/* Theme toggle */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">Tema</span>
                <button
                  onClick={toggleTheme}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-base-alt)] text-[var(--text-primary)] hover:brightness-90 transition-all"
                >
                  {theme === "dark" ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" />
                        <path
                          d="M8 3v1m0 8v1M3 8h1m8 0h1M4.22 4.22l.7.7m5.08 5.08l.7.7M4.22 11.78l.7-.7m5.08-5.08l.7-.7"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                      Oscuro
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M14 10.5a6 6 0 01-10.3-6A6 6 0 0114 10.5z"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Claro
                    </>
                  )}
                </button>
              </div>

              {/* Family Group */}
              <div>
                <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-3">
                  Grupo Familiar
                </h3>

                {/* Tu código de invitación — solo si no tiene grupo o es el único miembro */}
                {!isGroupLoading &&
                  (!myGroup ||
                    myGroup.members.filter((m) => m.status === "accepted").length <= 1) && (
                    <div className="mb-3 p-2 bg-[var(--color-base-alt)] rounded-md">
                      <p className="text-xs text-[var(--text-tertiary)] mb-1">
                        Compartí tu código:
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 font-mono text-sm text-[var(--text-primary)] select-all">
                          {myInviteCode?.invite_code ?? "—"}
                        </span>
                        {myInviteCode?.invite_code && (
                          <>
                            <button
                              onClick={() =>
                                navigator.clipboard.writeText(myInviteCode.invite_code)
                              }
                              className="p-1.5 rounded hover:bg-[var(--color-base)] text-[var(--text-tertiary)] hover:text-primary transition"
                              title="Copiar"
                            >
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                <rect
                                  x="5"
                                  y="5"
                                  width="9"
                                  height="9"
                                  rx="1"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                />
                                <path
                                  d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                />
                              </svg>
                            </button>
                            <button
                              onClick={() => setShowRegenInviteConfirm(true)}
                              className="p-1.5 rounded hover:bg-[var(--color-base)] text-[var(--text-tertiary)] hover:text-primary transition"
                              title="Nuevo código"
                            >
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                <path
                                  d="M13.2 2.8A7.2 7.2 0 002.8 7.2"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                />
                                <path
                                  d="M2.8 13.2A7.2 7.2 0 0013.2 8.8"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                />
                                <path
                                  d="M13.2 2.8V6h-3.2"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d="M2.8 13.2v-3.2h3.2"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                {isGroupLoading ? (
                  <div className="space-y-3">
                    <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse" />
                    <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse w-3/4" />
                    <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse w-1/2" />
                  </div>
                ) : myGroup ? (
                  <div className="space-y-3">
                    <p className="text-xs text-[var(--text-tertiary)]">{myGroup.name}</p>
                    <ul className="space-y-1.5">
                      {myGroup.members.map((m) => (
                        <li key={m.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-[var(--color-base-alt)] text-[var(--text-secondary)] flex items-center justify-center text-[10px] font-semibold">
                              {formatFullName(m.full_name)[0]?.toUpperCase() ?? "?"}
                            </span>
                            <span className="text-xs text-[var(--text-primary)]">
                              {formatFullName(m.full_name)}
                            </span>
                            {m.role === "admin" && (
                              <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                                Admin
                              </span>
                            )}
                          </div>
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              m.status === "accepted"
                                ? "bg-[var(--gnome-green-3,#33d17a)]/20 text-[var(--gnome-green-5,#26a269)]"
                                : m.status === "pending"
                                  ? "bg-[var(--gnome-yellow-3,#f6d32d)]/20 text-[var(--gnome-yellow-5,#e5a50a)]"
                                  : "bg-[var(--color-base-alt)] text-[var(--text-tertiary)]"
                            }`}
                          >
                            {m.status === "accepted"
                              ? "Activo"
                              : m.status === "pending"
                                ? "Pendiente"
                                : m.status}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {myGroup.members.filter((m) => m.status === "accepted").length < 5 && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          setInviteError(null);
                          setInviteSuccess(false);
                          setLeaveError(null);
                          if (
                            myInviteCode?.invite_code &&
                            inviteCode.trim() === myInviteCode.invite_code
                          ) {
                            setInviteError("No puedes invitarte a ti mismo");
                            return;
                          }
                          inviteMut.mutate();
                        }}
                        className="space-y-2"
                      >
                        <input
                          type="text"
                          value={inviteCode}
                          onChange={(e) => setInviteCode(e.target.value)}
                          placeholder="Código de invitación del familiar"
                          required
                          className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                        />
                        <button
                          type="submit"
                          disabled={inviteMut.isPending || !inviteCode.trim()}
                          className="w-full py-1.5 rounded-md bg-primary hover:brightness-110 disabled:opacity-60 text-[var(--color-on-primary)] text-xs font-medium transition"
                        >
                          {inviteMut.isPending ? "Invitando…" : "Invitar familiar"}
                        </button>
                      </form>
                    )}

                    {inviteError && (
                      <p className="text-xs text-[var(--red-3,#e01b24)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">
                        {inviteError}
                      </p>
                    )}
                    {inviteSuccess && (
                      <p className="text-xs text-[var(--green-5,#26a269)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">
                        Invitación enviada
                      </p>
                    )}

                    <button
                      onClick={() => setShowLeaveConfirm(true)}
                      disabled={leaveMut.isPending}
                      className="w-full py-1.5 rounded-md border border-[var(--red-3,#e01b24)]/30 text-[var(--red-3,#e01b24)] hover:bg-[var(--red-3,#e01b24)]/10 text-xs font-medium transition disabled:opacity-50"
                    >
                      {leaveMut.isPending ? "Saliendo…" : "Salir del grupo"}
                    </button>
                    {leaveError && (
                      <p className="text-xs text-[var(--red-3,#e01b24)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">
                        {leaveError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-[var(--text-tertiary)]">
                      No pertenecés a ningún grupo familiar. Ingresá el código de invitación de tu
                      familiar.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        setInviteError(null);
                        setInviteSuccess(false);
                        setLeaveError(null);
                        if (
                          myInviteCode?.invite_code &&
                          inviteCode.trim() === myInviteCode.invite_code
                        ) {
                          setInviteError("No puedes invitarte a ti mismo");
                          return;
                        }
                        inviteMut.mutate();
                      }}
                      className="space-y-2"
                    >
                      <input
                        type="text"
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        placeholder="Código de invitación"
                        required
                        className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                      />
                      <button
                        type="submit"
                        disabled={inviteMut.isPending || !inviteCode.trim()}
                        className="w-full py-1.5 rounded-md bg-primary hover:brightness-110 disabled:opacity-60 text-[var(--color-on-primary)] text-xs font-medium transition"
                      >
                        {inviteMut.isPending ? "Enviando…" : "Crear grupo e invitar"}
                      </button>
                    </form>
                    {inviteError && (
                      <p className="text-xs text-[var(--red-3,#e01b24)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">
                        {inviteError}
                      </p>
                    )}
                    {inviteSuccess && (
                      <p className="text-xs text-[var(--green-5,#26a269)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">
                        Invitación enviada
                      </p>
                    )}
                  </div>
                )}
              </div>

              <hr className="border-[var(--border-color)]" />

              {/* Telegram Bot */}
              <div>
                <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-3">
                  Telegram Bot
                </h3>

                {tgStatus?.connected ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-2 bg-[var(--gnome-green-3,#33d17a)]/10 rounded-md">
                      <span className="text-sm">✅</span>
                      <span className="text-xs font-medium text-[var(--gnome-green-5,#26a269)]">
                        Bot conectado
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      Tu bot de Telegram está vinculado y funcionando.{" "}
                      <a
                        href="https://t.me/NikoFin_bot"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Abrir @NikoFin_bot
                      </a>
                    </p>
                    <button
                      onClick={() => setShowRegenTelegramConfirm(true)}
                      disabled={regenerateKeyMut.isPending}
                      className="w-full py-1.5 rounded-md border border-[var(--red-3,#e01b24)]/30 text-[var(--red-3,#e01b24)] hover:bg-[var(--red-3,#e01b24)]/10 text-xs font-medium transition disabled:opacity-50"
                    >
                      {regenerateKeyMut.isPending ? "Desconectando…" : "Desconectar bot"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-2 bg-[var(--color-base-alt)] rounded-md">
                      <span className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />
                      <span className="text-xs font-medium text-[var(--text-tertiary)]">
                        Bot desconectado
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      Abrí{" "}
                      <a
                        href="https://t.me/NikoFin_bot"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        @NikoFin_bot
                      </a>{" "}
                      y enviá{" "}
                      <span className="font-mono bg-[var(--color-base-alt)] px-1 rounded">
                        /start
                      </span>
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex-1 font-mono text-sm bg-[var(--color-base-alt)] rounded-md px-3 py-2 tracking-widest text-[var(--text-primary)] select-all ${
                            !showTelegramKey ? "blur-sm" : ""
                          }`}
                        >
                          {tgKeyData?.telegram_key ?? "············"}
                        </span>
                        <button
                          onClick={handleCopyKey}
                          className="px-3 py-2 rounded-md border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
                        >
                          {keyCopied ? "✓" : "Copiar"}
                        </button>
                      </div>
                      <button
                        onClick={() => setShowRegenTelegramConfirm(true)}
                        disabled={regenerateKeyMut.isPending}
                        className="w-full py-1.5 rounded-md border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition disabled:opacity-50"
                      >
                        {regenerateKeyMut.isPending ? "Regenerando…" : "Regenerar clave"}
                      </button>
                    </div>
                    {!showTelegramKey && (
                      <p className="text-xs text-[var(--text-tertiary)]">
                        <button
                          onClick={() => setShowTelegramKey(true)}
                          className="text-primary hover:underline"
                        >
                          Mostrar clave
                        </button>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Weekly Summary Settings */}
              {tgStatus?.connected && (
                <div>
                  <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-3">
                    Resumen Semanal
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-primary)]">
                        Enviar resumen semanal
                      </span>
                      <button
                        onClick={() => {
                          const current = settings?.weekly_summary_enabled !== "false";
                          settingMut.mutate({
                            key: "weekly_summary_enabled",
                            value: current ? "false" : "true",
                          });
                        }}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          settings?.weekly_summary_enabled !== "false"
                            ? "bg-[var(--color-primary)]"
                            : "bg-[var(--text-tertiary)]"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                            settings?.weekly_summary_enabled !== "false"
                              ? "translate-x-4"
                              : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>
                    {settings?.weekly_summary_enabled !== "false" && (
                      <p className="text-[10px] text-[var(--text-tertiary)]">
                        Se envía todos los domingos a las 20:00 por Telegram
                      </p>
                    )}
                  </div>
                </div>
              )}

              <hr className="border-[var(--border-color)]" />

              {/* Change password */}
              <div>
                <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-3">
                  Cambiar contraseña
                </h3>
                <form onSubmit={handleChangePw} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      Contraseña actual
                    </label>
                    <input
                      type="password"
                      name="current-password"
                      autoComplete="current-password"
                      value={currentPw}
                      onChange={(e) => {
                        setCurrentPw(e.target.value);
                        setPwSuccess(false);
                      }}
                      placeholder="••••••••"
                      required
                      className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      Nueva contraseña
                    </label>
                    <input
                      type="password"
                      name="new-password"
                      autoComplete="new-password"
                      value={newPw}
                      onChange={(e) => {
                        setNewPw(e.target.value);
                        setPwSuccess(false);
                      }}
                      placeholder="Mínimo 8 caracteres"
                      required
                      className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      Repetir nueva contraseña
                    </label>
                    <input
                      type="password"
                      name="new-password"
                      autoComplete="new-password"
                      value={confirmPw}
                      onChange={(e) => {
                        setConfirmPw(e.target.value);
                        setPwSuccess(false);
                      }}
                      placeholder="••••••••"
                      required
                      className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                    />
                  </div>

                  {pwError && (
                    <p className="text-xs text-[var(--red-3,#e01b24)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">
                      {pwError}
                    </p>
                  )}
                  {pwSuccess && (
                    <p className="text-xs text-[var(--green-5,#26a269)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">
                      Contraseña actualizada correctamente
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={changePwMut.isPending}
                    className="w-full py-2 rounded-md bg-primary hover:brightness-110 disabled:opacity-60 text-[var(--color-on-primary)] font-medium text-sm transition"
                  >
                    {changePwMut.isPending ? "Guardando..." : "Guardar contraseña"}
                  </button>
                </form>
              </div>

              <hr className="border-[var(--border-color)]" />

              {/* MFA Section */}
              <div>
                <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-3">
                  Autenticación de dos factores (MFA)
                </h3>

                {mfaStatus?.enabled && !showDisableMfa && (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--green-5,#26a269)]/10 border border-[var(--green-5,#26a269)]/30">
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--green-5,#26a269)]">✓</span>
                      <span className="text-sm font-medium text-[var(--green-5,#26a269)]">
                        MFA habilitado
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setShowDisableMfa(true);
                        setMfaError(null);
                        setMfaSuccess(false);
                      }}
                      className="text-xs text-[var(--red-3,#e01b24)] hover:underline"
                    >
                      Deshabilitar
                    </button>
                  </div>
                )}

                {mfaStatus?.enabled && showDisableMfa && (
                  <div className="space-y-3">
                    <p className="text-xs text-[var(--text-secondary)]">
                      Ingresá el código de tu aplicación de autenticación para deshabilitar MFA.
                    </p>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={disableMfaCode}
                      onChange={(e) => setDisableMfaCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition font-mono text-center tracking-widest"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowDisableMfa(false);
                          setDisableMfaCode("");
                          setMfaError(null);
                        }}
                        className="flex-1 py-2 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] text-sm hover:bg-[var(--color-base-alt)] transition"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => disableMfaMut.mutate(disableMfaCode)}
                        disabled={disableMfaCode.length !== 6 || disableMfaMut.isPending}
                        className="flex-1 py-2 rounded-md bg-[var(--red-3,#e01b24)] text-white text-sm font-medium hover:brightness-110 disabled:opacity-60 transition"
                      >
                        {disableMfaMut.isPending ? "Deshabilitando..." : "Deshabilitar"}
                      </button>
                    </div>
                  </div>
                )}

                {!mfaStatus?.enabled && !mfaQrCode && (
                  <div>
                    <p className="text-xs text-[var(--text-secondary)] mb-3">
                      Protege tu cuenta con una segunda capa de seguridad. Necesitarás una
                      aplicación como Google Authenticator o Authy.
                    </p>
                    <button
                      onClick={() => setupMfaMut.mutate()}
                      disabled={setupMfaMut.isPending}
                      className="w-full py-2 rounded-md bg-primary hover:brightness-110 disabled:opacity-60 text-[var(--color-on-primary)] font-medium text-sm transition"
                    >
                      {setupMfaMut.isPending ? "Generando..." : "Habilitar MFA"}
                    </button>
                  </div>
                )}

                {mfaQrCode && (
                  <div className="space-y-3">
                    <p className="text-xs text-[var(--text-secondary)]">
                      1. Escaneá este código QR con tu aplicación de autenticación
                    </p>
                    <div className="flex justify-center">
                      <img src={mfaQrCode} alt="MFA QR Code" className="w-48 h-48 rounded-lg" />
                    </div>
                    {mfaSecret && (
                      <div className="text-center">
                        <p className="text-[10px] text-[var(--text-tertiary)] mb-1">
                          O ingresá este código manualmente:
                        </p>
                        <p className="text-xs font-mono bg-[var(--color-base)] border border-[var(--border-color)] rounded px-3 py-1.5 select-all">
                          {mfaSecret}
                        </p>
                      </div>
                    )}
                    <p className="text-xs text-[var(--text-secondary)]">
                      2. Ingresá el código de 6 dígitos de tu aplicación
                    </p>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition font-mono text-center tracking-widest"
                    />
                    <button
                      onClick={() => verifyMfaMut.mutate(mfaCode)}
                      disabled={mfaCode.length !== 6 || verifyMfaMut.isPending}
                      className="w-full py-2 rounded-md bg-primary hover:brightness-110 disabled:opacity-60 text-[var(--color-on-primary)] font-medium text-sm transition"
                    >
                      {verifyMfaMut.isPending ? "Verificando..." : "Verificar y habilitar"}
                    </button>
                  </div>
                )}

                {mfaError && (
                  <p className="text-xs text-[var(--red-3,#e01b24)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2 mt-2">
                    {mfaError}
                  </p>
                )}
                {mfaSuccess && !mfaQrCode && (
                  <p className="text-xs text-[var(--green-5,#26a269)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2 mt-2">
                    {showDisableMfa
                      ? "MFA deshabilitado correctamente"
                      : "MFA habilitado correctamente"}
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === "accounts" && (
            <div className="space-y-0">
              <AccountsManager />
              <CardsManager />
            </div>
          )}

          {activeTab === "reports" && <ReportsTab />}
        </div>

        {/* Logout */}
        <div className="px-5 py-4 border-t border-[var(--border-color)]">
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md border border-[var(--red-3,#e01b24)]/30 text-[var(--red-3,#e01b24)] hover:bg-[var(--red-3,#e01b24)]/10 text-sm font-medium transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 3H3a1 1 0 00-1 1v8a1 1 0 001 1h3M10 11l3-3-3-3M13 8H6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Cerrar sesión
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showLeaveConfirm}
        title="Salir del grupo"
        message="Al salir, no verás más los gastos de otros miembros del grupo. Esta acción se puede deshacer invitándote nuevamente."
        confirmLabel="Salir"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={() => {
          setShowLeaveConfirm(false);
          leaveMut.mutate();
        }}
        onCancel={() => setShowLeaveConfirm(false)}
      />

      <ConfirmDialog
        isOpen={showRegenInviteConfirm}
        title="Regenerar código de invitación"
        message="Regenerar el código invalidará el anterior. Si lo compartiste con alguien, esa persona ya no podrá usarlo."
        confirmLabel="Regenerar"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={() => {
          setShowRegenInviteConfirm(false);
          regenerateInviteCodeMut.mutate();
        }}
        onCancel={() => setShowRegenInviteConfirm(false)}
      />

      <ConfirmDialog
        isOpen={showRegenTelegramConfirm}
        title={tgStatus?.connected ? "Desconectar bot" : "Regenerar clave de Telegram"}
        message={
          tgStatus?.connected
            ? "Al regenerar la clave, se desconectará la sesión actual del bot. Necesitarás volver a vincularlo con la nueva clave."
            : "Regenerar la clave generará una nueva. Si tenías una anterior compartida, ya no funcionará."
        }
        confirmLabel={tgStatus?.connected ? "Desconectar" : "Regenerar"}
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={() => {
          setShowRegenTelegramConfirm(false);
          regenerateKeyMut.mutate();
          setShowTelegramKey(false);
        }}
        onCancel={() => setShowRegenTelegramConfirm(false)}
      />

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="Cerrar sesión"
        message="¿Estás seguro que querés cerrar sesión?"
        confirmLabel="Cerrar sesión"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={() => {
          setShowLogoutConfirm(false);
          handleLogout();
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </>
  );
}
