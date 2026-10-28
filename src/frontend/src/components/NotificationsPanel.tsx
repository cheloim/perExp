import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useUploadProgress } from "../context/UploadProgressContext";
import { useNotifications } from "../context/NotificationsContext";
import NotificationBulkActions from "./NotificationBulkActions";
import NotificationsList from "./NotificationsList";
import SymbolicIcon from "./SymbolicIcon";

interface Props {
  onClose: () => void;
}

/**
 * The notification popover.
 *
 * #455: it used to sit bottom-left over the sidebar at 320px, with the same
 * elevation as the rest of the chrome — it read as an accident rather than as
 * the place notifications live. It now hangs from the bell at the top right,
 * is wide enough to read a message in, and has the shadow to sit above the page.
 */
export default function NotificationsPanel({ onClose }: Props) {
  const navigate = useNavigate();
  const { uploads, removeUpload, cancelUpload } = useUploadProgress();
  const { notifications, connected } = useNotifications();

  // Once an import has landed as a notification, its progress row is noise.
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

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/25" onClick={onClose} aria-hidden="true" />

      <div
        className="fixed top-[calc(3.5rem+0.75rem)] right-4 z-40 w-[26rem] max-w-[calc(100vw-2rem)] bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl shadow-2xl ring-1 ring-black/10 flex flex-col max-h-[min(32rem,calc(100vh-6rem))] animate-modal-content"
        role="dialog"
        aria-label="Notificaciones"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)] font-semibold">
            <SymbolicIcon name="bell" size={18} className="text-[var(--color-primary)]" />
            <span>Notificaciones</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBulkActions compact />
            {notifications.length > 0 && (
              <button
                onClick={() => {
                  navigate("/notifications");
                  onClose();
                }}
                className="text-xs text-[var(--color-primary)] hover:underline transition-colors"
              >
                Ver todo →
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
          {/* Connection indicator */}
          {!connected && (
            <div className="px-4 py-2 bg-[var(--color-primary)]/5 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <p className="text-[var(--text-tertiary)] text-xs">Conectando...</p>
              </div>
            </div>
          )}

          {/* Upload progress */}
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
                <SymbolicIcon
                  name={upload.status === "failed" ? "warning" : "upload"}
                  size={16}
                  className={
                    upload.status === "failed"
                      ? "text-red-500"
                      : upload.status === "queued"
                        ? "text-amber-500"
                        : "text-[var(--color-primary)]"
                  }
                />
                <p
                  className="text-[var(--text-primary)] text-sm font-medium flex-1 truncate"
                  title={upload.filename}
                >
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
                {upload.status === "uploading" && "Subiendo archivo..."}
                {upload.status === "queued" && "En cola — esperando turno..."}
                {upload.status === "processing" && "Procesando con IA..."}
                {upload.status === "failed" && `Error: ${upload.error || "Falló el upload"}`}
              </p>
            </div>
          ))}

          {/* Empty state */}
          {notifications.length === 0 && uploads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <SymbolicIcon
                name="bell"
                size={40}
                className="text-[var(--text-tertiary)] opacity-40 mb-3"
              />
              <p className="text-[var(--text-secondary)] text-sm font-medium">¡Todo al día! ✨</p>
              <p className="text-[var(--text-tertiary)] text-xs mt-1">
                No tenés notificaciones pendientes
              </p>
            </div>
          )}

          <NotificationsList variant="panel" onAfterActivate={onClose} />
        </div>
      </div>
    </>
  );
}
