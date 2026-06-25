import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { rejectGroupInvitation } from "../api/client";
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
  const { uploads, removeUpload, cancelUpload } = useUploadProgress();
  const { notifications, markRead, markAllRead, refresh, connected } = useNotifications();
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

  const handleDeleteJob = async (jobId: number) => {
    const token = localStorage.getItem("auth_token");
    if (!token) return;
    try {
      await fetch(`/api/import-jobs/${jobId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
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
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

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
        className="fixed bottom-20 left-4 z-40 w-80 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome-lg flex flex-col max-h-[480px]"
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
              className="px-4 py-3 border-b border-[var(--border-color)] bg-[var(--color-primary)]/5"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-[var(--text-primary)] text-sm font-medium flex-1">
                  {upload.filename}
                </p>
                {upload.status === "failed" && <span className="text-red-600 text-xs">✕</span>}
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

              {upload.status !== "failed" && (
                <div className="relative w-full h-1 bg-[var(--color-base-alt)] rounded-full overflow-hidden mb-1.5">
                  <div className="absolute inset-0 bg-[var(--color-primary)] animate-progress-indeterminate" />
                </div>
              )}

              <p className="text-[var(--text-tertiary)] text-xs">
                {upload.status === "uploading" && "Subiendo archivo..."}
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
            return (
              <div
                key={n.id}
                onClick={() => isImportNotif && handleNotificationClick(n)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isImportNotif) handleNotificationClick(n);
                }}
                className={`px-4 py-3 border-b border-[var(--border-color)] last:border-0 ${
                  !n.read ? "bg-[var(--color-primary)]/8" : ""
                } ${
                  isImportNotif
                    ? "cursor-pointer hover:bg-[var(--color-base-alt)] transition-colors"
                    : ""
                }`}
                role={isImportNotif ? "button" : undefined}
                tabIndex={isImportNotif ? 0 : undefined}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-[var(--text-primary)] text-sm font-medium leading-tight">
                    {n.title}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-tertiary)] text-xs whitespace-nowrap">
                      {timeAgoValues.get(n.id) ?? timeAgo(n.created_at)}
                    </span>
                    {isImportNotif && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const jobId = "job_id" in n.data ? (n.data.job_id as number) : undefined;
                          if (jobId) {
                            setConfirmDelete({ jobId, notifId: n.id });
                          }
                        }}
                        className="text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                        title="Cancelar importación"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[var(--text-secondary)] text-xs mb-2 line-clamp-2">{n.body}</p>

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
                  handleDeleteJob(confirmDelete.jobId);
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
