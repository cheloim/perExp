import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { rejectGroupInvitation, downloadReportPdf } from "../api/client";
import type { Notification } from "../types";
import InvitationDisclaimer from "./InvitationDisclaimer";
import { useUploadProgress } from "../context/UploadProgressContext";
import { useNotifications } from "../context/NotificationsContext";

interface Props {
  onClose: () => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "Ahora";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora";
  if (mins < 60) return `Hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  return `Hace ${Math.floor(hours / 24)}d`;
}

export default function NotificationsPanel({ onClose }: Props) {
  const navigate = useNavigate();
  const [disclaimer, setDisclaimer] = useState<{ notifId: number; inviterName: string } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<{ jobId: number; notifId: number } | null>(
    null,
  );
  const [confirmReject, setConfirmReject] = useState<number | null>(null);
  const [confirmClearRead, setConfirmClearRead] = useState(false);
  const { uploads, removeUpload, cancelUpload } = useUploadProgress();
  const {
    notifications,
    markRead,
    markAllRead,
    deleteNotification,
    deleteAllRead,
    refresh,
    connected,
  } = useNotifications();
  const [, setTick] = useState(0);

  const timeAgoValues = useMemo(
    () => new Map(notifications.map((n) => [n.id, timeAgo(n.created_at)])),
    [notifications],
  );

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    uploads.forEach((upload) => {
      if (upload.status === "processing" && upload.jobId) {
        const hasNotification = notifications.some(
          (n) =>
            (n.type === "import_ready" || n.type === "import_failed") &&
            n.data.job_id === upload.jobId,
        );
        if (hasNotification) {
          removeUpload(upload.id);
        }
      }
    });
  }, [uploads, notifications, removeUpload]);

  const reject = useMutation({
    mutationFn: rejectGroupInvitation,
    onSuccess: () => {
      refresh();
    },
  });

  const handleAccept = (n: Notification) => {
    const inviterName =
      ("inviter_name" in n.data ? (n.data.inviter_name as string) : undefined) || "el invitante";
    setDisclaimer({ notifId: n.id, inviterName });
  };

  const handleMarkRead = async (id: number) => {
    await markRead(id);
  };

  const handleDeleteJob = async (jobId: number, notifId: number) => {
    const token = localStorage.getItem("auth_token");
    if (!token) return;
    try {
      await fetch(`/api/import-jobs/${jobId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await deleteNotification(notifId);
      refresh();
    } catch (err) {
      console.error("[NotificationsPanel] deleteJob failed", err);
    }
  };

  const handleNotificationClick = (n: Notification) => {
    if (n.type === "import_ready" || n.type === "import_failed") {
      const jobId = n.data.job_id;
      if (jobId) {
        handleMarkRead(n.id);
        navigate(`/import-jobs/${jobId}`);
        onClose();
      }
    } else if (n.type === "uncategorized_expense" || n.type === "uncategorized_expenses") {
      handleMarkRead(n.id);
      navigate("/expenses?uncategorized=1");
      onClose();
    } else if (n.type === "monthly_report_ready" || n.type === "monthly_report_queued") {
      handleMarkRead(n.id);
      if (n.type === "monthly_report_ready" && n.data.month) {
        downloadReportPdf(n.data.month);
      }
      onClose();
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const readCount = notifications.filter((n) => n.read).length;

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/10"
        onClick={onClose}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        role="button"
        tabIndex={-1}
        aria-label="Cerrar notificaciones"
      />

      <div
        className="fixed bottom-[calc(3.5rem+var(--browser-bottom-inset,0px))] left-4 z-40 w-80 max-w-[calc(100vw-2rem)] bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome-lg flex flex-col max-h-[480px]"
        role="dialog"
        aria-label="Notificaciones"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)] font-semibold">
            <svg
              width="18"
              height="18"
              viewBox="0 0 20 20"
              fill="none"
              className="text-[var(--color-primary)]"
            >
              <path
                d="M8 16a2 2 0 01-2-2h4a2 2 0 01-2 2v-3H8v3zM15 6a4 4 0 00-8 0v3h8V6z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            Notificaciones
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="text-xs text-[var(--color-primary)] hover:underline transition-colors"
              >
                Marcar todo leído
              </button>
            )}
            {readCount > 0 && (
              <button
                onClick={() => setConfirmClearRead(true)}
                className="text-xs text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
              >
                Limpiar leídas
              </button>
            )}
            <button
              onClick={onClose}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-lg leading-none"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {!connected && (
            <div className="px-4 py-3 bg-[var(--color-primary)]/5 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <p className="text-[var(--text-tertiary)] text-xs">Conectando...</p>
              </div>
            </div>
          )}

          {uploads.map((upload) => (
            <div
              key={upload.id}
              className={`px-4 py-3 border-b border-[var(--border-color)] bg-[var(--color-primary)]/5 border-l-4 ${
                upload.status === "failed"
                  ? "border-l-red-500"
                  : upload.status === "queued"
                    ? "border-l-amber-500"
                    : "border-l-[var(--color-primary)]"
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                {/* Status icon */}
                <span className="flex-shrink-0">
                  {upload.status === "uploading" && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      className="text-[var(--color-primary)]"
                    >
                      <path
                        d="M8 2v8M5 7l3 3 3-3"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                  {upload.status === "queued" && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      className="text-amber-500"
                    >
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                      <path
                        d="M8 4.5V8l2.5 1.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                  {upload.status === "processing" && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      className="text-[var(--color-primary)] animate-spin"
                    >
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeDasharray="28"
                        strokeDashoffset="8"
                      />
                    </svg>
                  )}
                  {upload.status === "failed" && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      className="text-red-500"
                    >
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                      <path
                        d="M6 6l4 4M10 6l-4 4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </span>
                <p className="text-[var(--text-primary)] text-sm font-medium flex-1 truncate">
                  {upload.filename}
                </p>
                {upload.status === "uploading" && (
                  <span className="text-[var(--color-primary)] text-xs font-medium">
                    {upload.progress ?? 0}%
                  </span>
                )}
                {upload.status === "uploading" && (
                  <button
                    onClick={() => cancelUpload(upload.id)}
                    className="text-[var(--text-tertiary)] hover:text-red-500 transition-colors text-xs"
                    title="Cancelar upload"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Progress bar */}
              {upload.status === "uploading" && upload.progress != null && (
                <div className="relative w-full h-1.5 bg-[var(--color-base-alt)] rounded-full overflow-hidden mb-1.5">
                  <div
                    className="absolute inset-y-0 left-0 bg-[var(--color-primary)] rounded-full transition-all duration-300"
                    style={{ width: `${upload.progress}%` }}
                  />
                </div>
              )}
              {upload.status === "queued" && (
                <div className="relative w-full h-1.5 bg-[var(--color-base-alt)] rounded-full overflow-hidden mb-1.5">
                  <div className="absolute inset-0 bg-amber-500/60 animate-progress-indeterminate" />
                </div>
              )}
              {upload.status === "processing" && (
                <div className="relative w-full h-1.5 bg-[var(--color-base-alt)] rounded-full overflow-hidden mb-1.5">
                  <div className="absolute inset-0 bg-[var(--color-primary)] animate-progress-indeterminate" />
                </div>
              )}

              <p className="text-[var(--text-tertiary)] text-xs">
                {upload.status === "uploading" && `Subiendo archivo...`}
                {upload.status === "queued" && "En cola — esperando turno..."}
                {upload.status === "processing" && "Procesando con IA..."}
                {upload.status === "failed" && `Error: ${upload.error || "Falló el upload"}`}
              </p>
            </div>
          ))}

          {notifications.length === 0 && uploads.length === 0 && (
            <p className="text-[var(--text-tertiary)] text-sm text-center py-8">
              Sin notificaciones
            </p>
          )}
          {notifications.map((n) => {
            const isImportNotif = n.type === "import_ready" || n.type === "import_failed";
            const isUncategorizedNotif =
              n.type === "uncategorized_expense" || n.type === "uncategorized_expenses";
            const isClickable = isImportNotif || isUncategorizedNotif || n.type === "monthly_report_ready" || n.type === "monthly_report_queued";
            const isFailed = n.type === "import_failed";
            return (
              <div
                key={n.id}
                onClick={() => isClickable && handleNotificationClick(n)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isClickable) handleNotificationClick(n);
                }}
                className={`px-4 py-3 border-b border-[var(--border-color)] last:border-0 ${
                  !n.read ? "bg-[var(--color-primary)]/8" : ""
                } ${
                  isClickable
                    ? "cursor-pointer hover:bg-[var(--color-base-alt)] transition-colors"
                    : ""
                } ${isImportNotif ? "border-l-4 " + (isFailed ? "border-l-red-500" : "border-l-green-500") : ""} ${isUncategorizedNotif ? "border-l-4 border-l-amber-500" : ""} ${(n.type === "monthly_report_ready" || n.type === "monthly_report_queued") ? "border-l-4 border-l-blue-500" : ""}`}
                role={isClickable ? "button" : undefined}
                tabIndex={isClickable ? 0 : undefined}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Notification icon */}
                    <span className="flex-shrink-0">
                      {isImportNotif && !isFailed && (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          className="text-green-500"
                        >
                          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                          <path
                            d="M5.5 8l2 2 3-3.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                      {isFailed && (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          className="text-red-500"
                        >
                          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                          <path
                            d="M6 6l4 4M10 6l-4 4"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      )}
                      {n.type === "group_invitation" && (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          className="text-[var(--color-primary)]"
                        >
                          <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                          <path
                            d="M2 13c0-2.2 1.8-4 4-4s4 1.8 4 4"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                          <path
                            d="M11 6v4M9 8h4"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      )}
                      {isUncategorizedNotif && (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          className="text-amber-500"
                        >
                          <path
                            d="M8 1.5l6.5 13H1.5L8 1.5z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M8 6.5v3"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                          <circle cx="8" cy="12" r="0.75" fill="currentColor" />
                        </svg>
                      )}
                      {n.type === "monthly_report_ready" && (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          className="text-blue-500"
                        >
                          <path
                            d="M4 1.5h8a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1v-11a1 1 0 011-1z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          />
                          <path
                            d="M5 5h6M5 8h6M5 11h3"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      )}
                    </span>
                    <p className="text-[var(--text-primary)] text-sm font-medium leading-tight truncate">
                      {n.title}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-tertiary)] text-xs whitespace-nowrap">
                      {timeAgoValues.get(n.id) ?? timeAgo(n.created_at)}
                    </span>
                    {isImportNotif ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const jobId = "job_id" in n.data ? (n.data.job_id as number) : undefined;
                          if (jobId) {
                            setConfirmDelete({ jobId, notifId: n.id });
                          }
                        }}
                        className="text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                        title="Eliminar importación"
                      >
                        ✕
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotification(n.id);
                          refresh();
                        }}
                        className="text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                        title="Eliminar notificación"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[var(--text-secondary)] text-xs mb-2 line-clamp-2">{n.body}</p>

                {isImportNotif && (
                  <p className="text-[var(--color-primary)] text-xs font-medium">
                    Ver importación →
                  </p>
                )}

                {isUncategorizedNotif && (
                  <p className="text-[var(--color-primary)] text-xs font-medium">
                    Ver gastos sin categoría →
                  </p>
                )}

                {n.type === "monthly_report_ready" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const month = n.data.month;
                      if (month) {
                        handleMarkRead(n.id);
                        downloadReportPdf(month);
                      }
                    }}
                    className="text-[var(--color-primary)] text-xs font-medium hover:underline"
                  >
                    Descargar imagen →
                  </button>
                )}

                {n.type === "group_invitation" &&
                  (() => {
                    const data = n.data;
                    const hasPendingInvite = data.member_id && !n.read;
                    if (!hasPendingInvite) return null;
                    return (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAccept(n)}
                          className="text-xs px-3 py-1 rounded-md bg-[var(--color-primary)] hover:brightness-110 text-white transition-colors"
                        >
                          ✓ Aceptar
                        </button>
                        <button
                          onClick={() => setConfirmReject(n.id)}
                          disabled={reject.isPending}
                          className="text-xs px-3 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition-colors disabled:opacity-50"
                        >
                          ✕ Rechazar
                        </button>
                      </div>
                    );
                  })()}
              </div>
            );
          })}
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-[var(--text-primary)] font-semibold text-lg mb-2">
              Eliminar importación
            </h2>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              Se eliminará la importación y su notificación. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] text-sm hover:bg-[var(--color-base-alt)] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  handleDeleteJob(confirmDelete.jobId, confirmDelete.notifId);
                  setConfirmDelete(null);
                }}
                className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-[var(--text-primary)] font-semibold text-lg mb-2">
              Rechazar invitación
            </h2>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              ¿Seguro que querés rechazar esta invitación? No podrás unirte a este grupo más
              adelante a menos que te vuelvan a invitar.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmReject(null)}
                className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] text-sm hover:bg-[var(--color-base-alt)] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  reject.mutate(confirmReject);
                  setConfirmReject(null);
                }}
                disabled={reject.isPending}
                className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {reject.isPending ? "Rechazando..." : "Rechazar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmClearRead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-[var(--text-primary)] font-semibold text-lg mb-2">
              Limpiar notificaciones leídas
            </h2>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              Se eliminarán {readCount} notificación{readCount !== 1 ? "es" : ""} leída
              {readCount !== 1 ? "s" : ""}. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmClearRead(false)}
                className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] text-sm hover:bg-[var(--color-base-alt)] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  deleteAllRead();
                  setConfirmClearRead(false);
                }}
                className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {disclaimer && (
        <InvitationDisclaimer
          notificationId={disclaimer.notifId}
          inviterName={disclaimer.inviterName}
          onClose={() => setDisclaimer(null)}
        />
      )}
    </>
  );
}
