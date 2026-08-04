import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAdminUsers,
  getAdminUser,
  blockUser,
  unblockUser,
  toggleAdmin,
  getAuditLogs,
  getLoginErrors,
  getAdminReports,
  deleteAdminReport,
  generateAllReports,
  getSystemHealth,
  getTaskStatus,
  getAdminSettings,
  updateAdminSetting,
  requestImpersonation,
  cleanupAuditLogs,
  sendNotificationToUser,
  getPlatformLogs,
  runTask,
} from "../api/client";
import type { AdminUser, AuditLogEntry, LoginErrorsResponse, PlatformLog } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";

type Tab = "users" | "logs" | "reports" | "system";

const ACTION_COLORS: Record<string, string> = {
  login_failed: "text-[var(--color-danger)]",
  login_success: "text-[var(--color-success)]",
  mfa_failed: "text-[var(--color-danger)]",
  register: "text-[var(--color-info)]",
  account_deleted: "text-[var(--color-danger)]",
};

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");

  if (window.innerWidth < 1024) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-[var(--text-[var(--text-secondary)])] text-lg">
          Panel de administración solo disponible en desktop.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Panel de Administración</h1>
      </div>

      <nav className="flex gap-1 border-b border-[var(--border-color)]">
        {(["users", "logs", "reports", "system"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--text-[var(--text-tertiary)])] hover:text-[var(--text-[var(--text-secondary)])]"
            }`}
          >
            {t === "users"
              ? "Usuarios"
              : t === "logs"
                ? "Logs & Seguridad"
                : t === "reports"
                  ? "Reportes"
                  : "Sistema"}
          </button>
        ))}
      </nav>

      {tab === "users" && <UsersTab />}
      {tab === "logs" && <LogsTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "system" && <SystemTab />}
    </div>
  );
}

// ── Users Tab ──────────────────────────────────────────────

function UsersTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [blockDialog, setBlockDialog] = useState<{ id: number; email: string } | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [notifyDialog, setNotifyDialog] = useState<{ id: number; email: string } | null>(null);
  const [notifyTitle, setNotifyTitle] = useState("");
  const [notifyBody, setNotifyBody] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", search, page],
    queryFn: () => getAdminUsers({ search, page, per_page: 50 }),
  });

  const blockMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => blockUser(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const unblockMut = useMutation({
    mutationFn: (id: number) => unblockUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const toggleAdminMut = useMutation({
    mutationFn: (id: number) => toggleAdmin(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const impersonateMut = useMutation({
    mutationFn: (id: number) => requestImpersonation(id),
    onSuccess: () => {
      alert("Solicitud de impersonación enviada. Esperando aceptación del usuario.");
    },
  });

  const notifyMut = useMutation({
    mutationFn: ({ id, title, body }: { id: number; title: string; body: string }) =>
      sendNotificationToUser(id, title, body),
    onSuccess: () => {
      setNotifyDialog(null);
      setNotifyTitle("");
      setNotifyBody("");
    },
  });

  const users: AdminUser[] = data?.users ?? [];
  const total = data?.total ?? 0;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Buscar por email o nombre..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="input max-w-sm"
        />
        <span className="text-xs text-[var(--text-[var(--text-tertiary)])]">{total} usuarios</span>
      </div>

      {isLoading ? (
        <p className="text-[var(--text-[var(--text-tertiary)])]">Cargando...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-color)]">
                <th className="text-left py-2 px-3 text-[var(--text-[var(--text-tertiary)])] font-medium">ID</th>
                <th className="text-left py-2 px-3 text-[var(--text-[var(--text-tertiary)])] font-medium">Nombre</th>
                <th className="text-left py-2 px-3 text-[var(--text-[var(--text-tertiary)])] font-medium">Email</th>
                <th className="text-left py-2 px-3 text-[var(--text-[var(--text-tertiary)])] font-medium">Estado</th>
                <th className="text-left py-2 px-3 text-[var(--text-[var(--text-tertiary)])] font-medium">Admin</th>
                <th className="text-left py-2 px-3 text-[var(--text-[var(--text-tertiary)])] font-medium">Telegram</th>
                <th className="text-left py-2 px-3 text-[var(--text-[var(--text-tertiary)])] font-medium">MFA</th>
                <th className="text-left py-2 px-3 text-[var(--text-[var(--text-tertiary)])] font-medium">Creado</th>
                <th className="text-left py-2 px-3 text-[var(--text-[var(--text-tertiary)])] font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[var(--border-color)] hover:bg-[var(--color-base-alt)]">
                  <td className="py-2 px-3">{u.id}</td>
                  <td className="py-2 px-3">{u.full_name || "-"}</td>
                  <td className="py-2 px-3">{u.email}</td>
                  <td className="py-2 px-3">
                    {u.is_blocked ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--gnome-red-1)] text-[var(--gnome-red-5)]">
                        Bloqueado
                      </span>
                    ) : u.is_locked ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--gnome-orange-1)] text-[var(--gnome-orange-5)]">
                        Lock ({u.lock_ttl}s)
                      </span>
                    ) : u.is_active ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--gnome-green-1)] text-[var(--gnome-green-5)]">
                        Activo
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-base-alt)] text-[var(--text-[var(--text-tertiary)])]">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {u.is_admin && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--gnome-purple-1)] text-[var(--gnome-purple-5)]">
                        Admin
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {u.telegram_connected ? (
                      <span className="text-[var(--color-success)]">✓</span>
                    ) : (
                      <span className="text-[var(--text-[var(--text-tertiary)])]">-</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {u.mfa_enabled ? (
                      <span className="text-[var(--color-success)]">✓</span>
                    ) : (
                      <span className="text-[var(--text-[var(--text-tertiary)])]">-</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-[var(--text-[var(--text-tertiary)])]">
                    {new Date(u.created_at).toLocaleDateString("es-AR")}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex gap-1 flex-wrap">
                      <button
                        onClick={() => setSelectedUser(u.id)}
                        className="text-xs px-2 py-1 rounded bg-[var(--color-base-alt)] hover:bg-[var(--border-color)]"
                      >
                        Ver
                      </button>
                      {u.is_blocked ? (
                        <button
                          onClick={() => unblockMut.mutate(u.id)}
                          className="text-xs px-2 py-1 rounded bg-[var(--gnome-green-1)] text-[var(--gnome-green-5)] hover:bg-[var(--gnome-green-2)]"
                        >
                          Desbloquear
                        </button>
                      ) : (
                        <button
                          onClick={() => setBlockDialog({ id: u.id, email: u.email })}
                          className="text-xs px-2 py-1 rounded bg-[var(--gnome-red-1)] text-[var(--gnome-red-5)] hover:bg-[var(--gnome-red-2)]"
                        >
                          Bloquear
                        </button>
                      )}
                      <button
                        onClick={() => toggleAdminMut.mutate(u.id)}
                        className="text-xs px-2 py-1 rounded bg-[var(--gnome-purple-1)] text-[var(--gnome-purple-5)] hover:bg-[var(--gnome-purple-2)]"
                      >
                        {u.is_admin ? "Quitar Admin" : "Hacer Admin"}
                      </button>
                      <button
                        onClick={() => impersonateMut.mutate(u.id)}
                        className="text-xs px-2 py-1 rounded bg-[var(--gnome-blue-1)] text-[var(--gnome-blue-5)] hover:bg-[var(--gnome-blue-2)]"
                      >
                        Impersonar
                      </button>
                      <button
                        onClick={() => setNotifyDialog({ id: u.id, email: u.email })}
                        className="text-xs px-2 py-1 rounded bg-[var(--color-base-alt)] hover:bg-[var(--border-color)]"
                      >
                        Notificar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 50 && (
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="gnome-btn-secondary-round text-xs"
          >
            Anterior
          </button>
          <span className="text-xs text-[var(--text-[var(--text-tertiary)])]">Página {page}</span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page * 50 >= total}
            className="gnome-btn-secondary-round text-xs"
          >
            Siguiente
          </button>
        </div>
      )}

      {/* Block dialog */}
      {blockDialog && (
        <ConfirmDialog
          isOpen={true}
          title={`Bloquear ${blockDialog.email}`}
          message={
            <div>
              <p className="mb-2">¿Estás seguro? El usuario no podrá iniciar sesión.</p>
              <input
                type="text"
                placeholder="Razón del bloqueo..."
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                className="input w-full"
              />
            </div>
          }
          confirmLabel="Bloquear"
          variant="danger"
          onConfirm={() => {
            blockMut.mutate({ id: blockDialog.id, reason: blockReason });
            setBlockDialog(null);
            setBlockReason("");
          }}
          onCancel={() => {
            setBlockDialog(null);
            setBlockReason("");
          }}
        />
      )}

      {/* Notify dialog */}
      {notifyDialog && (
        <ConfirmDialog
          isOpen={true}
          title={`Notificar a ${notifyDialog.email}`}
          message={
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Título..."
                value={notifyTitle}
                onChange={(e) => setNotifyTitle(e.target.value)}
                className="input w-full"
              />
              <textarea
                placeholder="Mensaje..."
                value={notifyBody}
                onChange={(e) => setNotifyBody(e.target.value)}
                className="input w-full"
                rows={3}
              />
            </div>
          }
          confirmLabel="Enviar"
          variant="primary"
          onConfirm={() => {
            notifyMut.mutate({ id: notifyDialog.id, title: notifyTitle, body: notifyBody });
          }}
          onCancel={() => {
            setNotifyDialog(null);
            setNotifyTitle("");
            setNotifyBody("");
          }}
        />
      )}

      {/* User detail modal */}
      {selectedUser && <UserDetailModal userId={selectedUser} onClose={() => setSelectedUser(null)} />}
    </div>
  );
}

function UserDetailModal({ userId, onClose }: { userId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => getAdminUser(userId),
  });

  if (isLoading) return <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"><div className="card p-6">Cargando...</div></div>;
  if (!data) return null;

  const { user, stats, security, recent_audit_logs } = data;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="card p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Usuario #{user.id}</h2>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Nombre</p>
            <p className="text-sm">{user.full_name || "-"}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Email</p>
            <p className="text-sm">{user.email}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Estado</p>
            <p className="text-sm">
              {user.is_blocked ? "Bloqueado" : user.is_active ? "Activo" : "Inactivo"}
              {user.blocked_reason && ` (${user.blocked_reason})`}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Admin</p>
            <p className="text-sm">{user.is_admin ? "Sí" : "No"}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Proveedor</p>
            <p className="text-sm">{user.provider || "Email"}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Creado</p>
            <p className="text-sm">{new Date(user.created_at).toLocaleString("es-AR")}</p>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Estadísticas</h3>
        <div className="grid grid-cols-5 gap-2 mb-4">
          {[
            { label: "Gastos", value: stats.expense_count },
            { label: "Tarjetas", value: stats.card_count },
            { label: "Cuentas", value: stats.account_count },
            { label: "Recurrentes", value: stats.recurring_count },
            { label: "Reportes", value: stats.report_count },
          ].map((s) => (
            <div key={s.label} className="card p-2 text-center">
              <p className="text-lg font-bold text-[var(--text-primary)]">{s.value}</p>
              <p className="text-xs text-[var(--text-tertiary)]">{s.label}</p>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Seguridad</h3>
        <div className="mb-4">
          <p className="text-sm">
            Lock Redis: {security.is_locked ? `Sí (${security.lock_ttl}s)` : "No"}
          </p>
        </div>

        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Logs recientes</h3>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {recent_audit_logs.map((log: AuditLogEntry) => (
            <div key={log.id} className="flex items-center gap-2 text-xs">
              <span className="text-[var(--text-tertiary)] w-32 shrink-0">
                {new Date(log.created_at).toLocaleString("es-AR")}
              </span>
              <span className={ACTION_COLORS[log.action] || "text-[var(--text-secondary)]"}>{log.action}</span>
              {log.details && <span className="text-[var(--text-tertiary)] truncate">{log.details}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Logs & Security Tab ────────────────────────────────────

function LogsTab() {
  const [actionFilter, setActionFilter] = useState("");
  const [userIdFilter, setUserIdFilter] = useState("");
  const [page, setPage] = useState(1);

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ["admin-logs", actionFilter, userIdFilter, page],
    queryFn: () =>
      getAuditLogs({
        action: actionFilter || undefined,
        user_id: userIdFilter ? Number(userIdFilter) : undefined,
        page,
        per_page: 100,
      }),
  });

  const { data: errorsData } = useQuery({
    queryKey: ["admin-login-errors"],
    queryFn: () => getLoginErrors({ days: 30 }),
  });

  const logs: AuditLogEntry[] = logsData?.logs ?? [];
  const errors: LoginErrorsResponse = errorsData ?? {
    by_user: [],
    by_ip: [],
    blocked_accounts: [],
    redis_lockouts: [],
  };

  return (
    <div className="space-y-6">
      {/* Login errors summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Top usuarios con intentos fallidos</h3>
          {errors.by_user.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)]">Sin intentos fallidos</p>
          ) : (
            <div className="space-y-1">
              {errors.by_user.slice(0, 10).map((u) => (
                <div key={u.user_id} className="flex items-center justify-between text-xs">
                  <span>{u.email || `User #${u.user_id}`}</span>
                  <span className="text-[var(--color-danger)] font-medium">{u.count} fails</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Top IPs con intentos fallidos</h3>
          {errors.by_ip.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)]">Sin intentos fallidos</p>
          ) : (
            <div className="space-y-1">
              {errors.by_ip.slice(0, 10).map((ip, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-mono">{ip.ip_address}</span>
                  <span className="text-[var(--color-danger)] font-medium">{ip.count} fails</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Cuentas bloqueadas (admin)</h3>
          {errors.blocked_accounts.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)]">Sin cuentas bloqueadas</p>
          ) : (
            <div className="space-y-1">
              {errors.blocked_accounts.map((u) => (
                <div key={u.id} className="flex items-center justify-between text-xs">
                  <span>{u.email}</span>
                  <span className="text-[var(--text-tertiary)]">{u.blocked_reason || "Sin razón"}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Locks Redis activos</h3>
          {errors.redis_lockouts.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)]">Sin locks activos</p>
          ) : (
            <div className="space-y-1">
              {errors.redis_lockouts.map((u) => (
                <div key={u.user_id} className="flex items-center justify-between text-xs">
                  <span>{u.email || `User #${u.user_id}`}</span>
                  <span className="text-orange-500">{u.ttl_seconds}s</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Audit logs table */}
      <div className="card p-4">
        <div className="flex items-center gap-3 mb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Logs de Auditoría</h3>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="input text-xs"
          >
            <option value="">Todas las acciones</option>
            <option value="login_failed">login_failed</option>
            <option value="login_success">login_success</option>
            <option value="register">register</option>
            <option value="mfa_failed">mfa_failed</option>
            <option value="password_changed">password_changed</option>
            <option value="account_deleted">account_deleted</option>
          </select>
          <input
            type="number"
            placeholder="User ID"
            value={userIdFilter}
            onChange={(e) => {
              setUserIdFilter(e.target.value);
              setPage(1);
            }}
            className="input text-xs w-24"
          />
        </div>

        {logsLoading ? (
          <p className="text-[var(--text-tertiary)] text-xs">Cargando...</p>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Fecha</th>
                  <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Usuario</th>
                  <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Acción</th>
                  <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">IP</th>
                  <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Detalles</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-[var(--border-color)] hover:bg-[var(--color-base-alt)]">
                    <td className="py-1.5 px-2 text-[var(--text-tertiary)] whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString("es-AR")}
                    </td>
                    <td className="py-1.5 px-2">{log.user_email || `#${log.user_id}`}</td>
                    <td className={`py-1.5 px-2 font-medium ${ACTION_COLORS[log.action] || ""}`}>
                      {log.action}
                    </td>
                    <td className="py-1.5 px-2 font-mono">{log.ip_address || "-"}</td>
                    <td className="py-1.5 px-2 text-[var(--text-tertiary)] truncate max-w-xs">{log.details || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="gnome-btn-secondary-round text-xs"
          >
            Anterior
          </button>
          <span className="text-xs text-[var(--text-tertiary)]">Página {page}</span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={logs.length < 100}
            className="gnome-btn-secondary-round text-xs"
          >
            Siguiente
          </button>
        </div>
      </div>

      {/* Platform logs */}
      <PlatformLogsSection />
    </div>
  );
}

// ── Platform Logs Section ──────────────────────────────────

function PlatformLogsSection() {
  const [levelFilter, setLevelFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-platform-logs", levelFilter, moduleFilter, searchFilter, page],
    queryFn: () =>
      getPlatformLogs({
        level: levelFilter || undefined,
        module: moduleFilter || undefined,
        search: searchFilter || undefined,
        page,
        per_page: 100,
      }),
  });

  const logs: PlatformLog[] = data?.logs ?? [];

  const LEVEL_COLORS: Record<string, string> = {
    WARNING: "text-[var(--gnome-orange-3)]",
    ERROR: "text-[var(--gnome-red-3)]",
    CRITICAL: "bg-[var(--gnome-red-1)] text-[var(--gnome-red-5)]",
  };

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Logs de Plataforma</h3>
        <select
          value={levelFilter}
          onChange={(e) => {
            setLevelFilter(e.target.value);
            setPage(1);
          }}
          className="input text-xs"
        >
          <option value="">Todos los niveles</option>
          <option value="WARNING">WARNING</option>
          <option value="ERROR">ERROR</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>
        <input
          type="text"
          placeholder="Módulo..."
          value={moduleFilter}
          onChange={(e) => {
            setModuleFilter(e.target.value);
            setPage(1);
          }}
          className="input text-xs w-32"
        />
        <input
          type="text"
          placeholder="Buscar mensaje..."
          value={searchFilter}
          onChange={(e) => {
            setSearchFilter(e.target.value);
            setPage(1);
          }}
          className="input text-xs w-48"
        />
        <span className="text-xs text-[var(--text-tertiary)]">{data?.total ?? 0} logs</span>
      </div>

      {isLoading ? (
        <p className="text-[var(--text-tertiary)] text-xs">Cargando...</p>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-color)]">
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Fecha</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Nivel</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Módulo</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className={`border-b border-[var(--border-color)] hover:bg-[var(--color-base-alt)] ${
                    log.level === "CRITICAL" ? "bg-[var(--gnome-red-1)]/50" : ""
                  }`}
                >
                  <td className="py-1.5 px-2 text-[var(--text-tertiary)] whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString("es-AR")}
                  </td>
                  <td className={`py-1.5 px-2 font-medium ${LEVEL_COLORS[log.level] || ""}`}>
                    {log.level}
                  </td>
                  <td className="py-1.5 px-2 font-mono">{log.module}</td>
                  <td className="py-1.5 px-2 max-w-lg truncate" title={log.message}>
                    {log.message}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-[var(--text-tertiary)]">
                    Sin logs de plataforma
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page === 1}
          className="gnome-btn-secondary-round text-xs"
        >
          Anterior
        </button>
        <span className="text-xs text-[var(--text-tertiary)]">Página {page}</span>
        <button
          onClick={() => setPage(page + 1)}
          disabled={logs.length < 100}
          className="gnome-btn-secondary-round text-xs"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

// ── Reports Tab ────────────────────────────────────────────

function ReportsTab() {
  const queryClient = useQueryClient();
  const [userFilter, setUserFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [generateMonth, setGenerateMonth] = useState("");
  const [generating, setGenerating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-reports", userFilter, monthFilter, statusFilter],
    queryFn: () =>
      getAdminReports({
        user_id: userFilter ? Number(userFilter) : undefined,
        month: monthFilter || undefined,
        status: statusFilter || undefined,
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAdminReport(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-reports"] }),
  });

  const handleGenerateAll = async () => {
    if (!generateMonth) return;
    setGenerating(true);
    try {
      const result = await generateAllReports(generateMonth);
      alert(`Reportes encolados: ${result.created} para ${generateMonth}`);
      queryClient.invalidateQueries({ queryKey: ["admin-reports"] });
    } catch (e: any) {
      alert(`Error: ${e.response?.data?.detail || e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const reports = data?.reports ?? [];

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3 mb-4">
        <input
          type="number"
          placeholder="User ID"
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="input text-xs w-24"
        />
        <input
          type="month"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="input text-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input text-xs"
        >
          <option value="">Todos</option>
          <option value="PENDING">Pendiente</option>
          <option value="READY">Listo</option>
          <option value="FAILED">Error</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          <input
            type="month"
            value={generateMonth}
            onChange={(e) => setGenerateMonth(e.target.value)}
            className="input text-xs"
            placeholder="Mes a generar"
          />
          <button
            onClick={handleGenerateAll}
            disabled={!generateMonth || generating}
            className="gnome-btn-primary-round text-xs"
          >
            {generating ? "Generando..." : "Generar para todos"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-[var(--text-tertiary)] text-xs">Cargando...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-color)]">
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">ID</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Usuario</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Mes</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Estado</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Creado</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Generado</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">PNG</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r: any) => (
                <tr key={r.id} className="border-b border-[var(--border-color)] hover:bg-[var(--color-base-alt)]">
                  <td className="py-1.5 px-2">{r.id}</td>
                  <td className="py-1.5 px-2">{r.user_email || `#${r.user_id}`}</td>
                  <td className="py-1.5 px-2">{r.month}</td>
                  <td className="py-1.5 px-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        r.status === "READY"
                          ? "bg-[var(--gnome-green-1)] text-[var(--gnome-green-5)]"
                          : r.status === "FAILED"
                            ? "bg-[var(--gnome-red-1)] text-[var(--gnome-red-5)]"
                            : "bg-[var(--gnome-orange-1)] text-[var(--gnome-orange-5)]"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-[var(--text-tertiary)]">
                    {new Date(r.created_at).toLocaleDateString("es-AR")}
                  </td>
                  <td className="py-1.5 px-2 text-[var(--text-tertiary)]">
                    {r.generated_at ? new Date(r.generated_at).toLocaleDateString("es-AR") : "-"}
                  </td>
                  <td className="py-1.5 px-2">{r.has_png ? "✓" : "-"}</td>
                  <td className="py-1.5 px-2">
                    <button
                      onClick={() => {
                        if (confirm("¿Eliminar este reporte?")) deleteMut.mutate(r.id);
                      }}
                      className="text-xs px-2 py-1 rounded bg-[var(--gnome-red-1)] text-[var(--gnome-red-5)] hover:bg-[var(--gnome-red-2)]"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── System Tab ─────────────────────────────────────────────

function SystemTab() {
  const queryClient = useQueryClient();
  const [editingSetting, setEditingSetting] = useState<{ key: string; value: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [taskRunStates, setTaskRunStates] = useState<Record<string, "idle" | "running" | "done" | "error">>({});

  const { data: health } = useQuery({
    queryKey: ["admin-health"],
    queryFn: getSystemHealth,
    refetchInterval: 30000,
  });

  const { data: tasks } = useQuery({
    queryKey: ["admin-tasks"],
    queryFn: getTaskStatus,
  });

  const { data: settingsData } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: getAdminSettings,
  });

  const updateSettingMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => updateAdminSetting(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      setEditingSetting(null);
    },
  });

  const cleanupMut = useMutation({
    mutationFn: cleanupAuditLogs,
    onSuccess: (data: any) => {
      alert(`Limpieza completada: ${data.audit_logs_deleted} logs, ${data.messages_deleted} mensajes eliminados.`);
    },
  });

  const handleRunTask = async (taskName: string) => {
    setTaskRunStates((prev) => ({ ...prev, [taskName]: "running" }));
    try {
      await runTask(taskName);
      setTaskRunStates((prev) => ({ ...prev, [taskName]: "done" }));
      setTimeout(() => {
        setTaskRunStates((prev) => ({ ...prev, [taskName]: "idle" }));
      }, 3000);
    } catch {
      setTaskRunStates((prev) => ({ ...prev, [taskName]: "error" }));
      setTimeout(() => {
        setTaskRunStates((prev) => ({ ...prev, [taskName]: "idle" }));
      }, 3000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Health */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Redis</h3>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${health?.redis?.connected ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-sm">{health?.redis?.connected ? "Conectado" : "Desconectado"}</span>
            {health?.redis?.connected && (
              <span className="text-xs text-[var(--text-tertiary)]">{health.redis.latency_ms}ms</span>
            )}
          </div>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Base de Datos</h3>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${health?.database?.connected ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-sm">{health?.database?.connected ? "Conectada" : "Desconectada"}</span>
            {health?.database?.connected && (
              <span className="text-xs text-[var(--text-tertiary)]">{health.database.users_count} usuarios</span>
            )}
          </div>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Celery</h3>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${health?.celery?.worker_count > 0 ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-sm">{health?.celery?.worker_count ?? 0} workers</span>
          </div>
        </div>
      </div>

      {/* Tasks */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Tareas Programadas</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-color)]">
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Tarea</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Última ejecución</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium w-24">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(tasks?.tasks ?? []).map((t: any) => {
                const state = taskRunStates[t.name] || "idle";
                return (
                  <tr key={t.name} className="border-b border-[var(--border-color)]">
                    <td className="py-1.5 px-2 font-mono">{t.name}</td>
                    <td className="py-1.5 px-2 text-[var(--text-tertiary)]">{t.last_run}</td>
                    <td className="py-1.5 px-2">
                      {state === "idle" && (
                        <button
                          onClick={() => handleRunTask(t.name)}
                          className="text-xs px-2 py-1 rounded bg-[var(--color-base-alt)] hover:bg-[var(--border-color)] text-[var(--text-primary)]"
                          title="Ejecutar tarea"
                        >
                          ▶ Ejecutar
                        </button>
                      )}
                      {state === "running" && (
                        <span className="text-xs text-[var(--color-primary)] flex items-center gap-1">
                          <span className="animate-spin">⏳</span> Ejecutando...
                        </span>
                      )}
                      {state === "done" && (
                        <span className="text-xs text-[var(--color-success)] animate-pulse">
                          ✓ Ejecutado
                        </span>
                      )}
                      {state === "error" && (
                        <span className="text-xs text-[var(--color-danger)] animate-pulse">
                          ✗ Error
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Settings */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Settings</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-color)]">
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Key</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Value</th>
                <th className="text-left py-1.5 px-2 text-[var(--text-tertiary)] font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(settingsData?.settings ?? []).map((s: any) => (
                <tr key={s.key} className="border-b border-[var(--border-color)]">
                  <td className="py-1.5 px-2 font-mono">{s.key}</td>
                  <td className="py-1.5 px-2">
                    {editingSetting?.key === s.key ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="input text-xs w-full"
                      />
                    ) : (
                      <span className="text-[var(--text-tertiary)] truncate max-w-xs block">{s.value}</span>
                    )}
                  </td>
                  <td className="py-1.5 px-2">
                    {editingSetting?.key === s.key ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => updateSettingMut.mutate({ key: s.key, value: editValue })}
                          className="text-xs px-2 py-1 rounded bg-[var(--gnome-green-1)] text-[var(--gnome-green-5)]"
                        >
                          Guardar
                        </button>
                        <button
                          onClick={() => setEditingSetting(null)}
                          className="text-xs px-2 py-1 rounded bg-[var(--color-base-alt)]"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingSetting(s);
                          setEditValue(s.value);
                        }}
                        className="text-xs px-2 py-1 rounded bg-[var(--color-base-alt)] hover:bg-[var(--border-color)]"
                      >
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cleanup */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Mantenimiento</h3>
        <button
          onClick={() => {
            if (confirm("¿Ejecutar limpieza de logs antiguos?")) cleanupMut.mutate();
          }}
          className="gnome-btn-secondary-round text-xs"
        >
          Limpiar Audit Logs (90d) y Mensajes (45d)
        </button>
      </div>
    </div>
  );
}
