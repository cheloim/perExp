import { useEffect } from "react";
import { useUploadProgress } from "../context/UploadProgressContext";
import { useNotifications } from "../context/NotificationsContext";
import SymbolicIcon from "./SymbolicIcon";

/**
 * Upload progress, as a banner.
 *
 * It used to live inside the notifications popover. With the popover gone, an
 * ongoing state needs its own home — and the HIG puts ongoing states in
 * banners, not toasts.
 */
export default function UploadProgressBanner() {
  const { uploads, removeUpload, cancelUpload } = useUploadProgress();
  const { notifications } = useNotifications();

  // Once an import has landed as a notification, its progress row is noise.
  useEffect(() => {
    uploads.forEach((upload) => {
      if (upload.status === "processing" && upload.jobId) {
        const hasNotification = notifications.some(
          (n) =>
            (n.type === "import_ready" || n.type === "import_failed") &&
            n.data.job_id === upload.jobId,
        );
        if (hasNotification) removeUpload(upload.id);
      }
    });
  }, [uploads, notifications, removeUpload]);

  if (uploads.length === 0) return null;

  return (
    <div
      className="border-b border-[var(--border-color)] bg-[var(--color-primary)]/5"
      role="status"
      aria-live="polite"
    >
      <div className="w-full px-4 sm:px-6 lg:px-8 py-2 max-w-[1400px] mx-auto space-y-2">
        {uploads.map((upload) => (
          <div key={upload.id}>
            <div className="flex items-center gap-2">
              <SymbolicIcon
                name={upload.status === "failed" ? "warning" : "upload"}
                size={15}
                className={
                  upload.status === "failed"
                    ? "text-red-500"
                    : upload.status === "queued"
                      ? "text-amber-500"
                      : "text-[var(--color-primary)]"
                }
              />
              <p
                className="text-[var(--text-primary)] text-sm font-medium truncate min-w-0"
                title={upload.filename}
              >
                {upload.filename}
              </p>
              <p className="text-[var(--text-tertiary)] text-xs whitespace-nowrap">
                {upload.status === "uploading" && `Subiendo ${upload.progress ?? 0}%`}
                {upload.status === "queued" && "En cola"}
                {upload.status === "processing" && "Procesando con IA"}
                {upload.status === "failed" && `Error: ${upload.error || "Falló el upload"}`}
              </p>
              {upload.status === "uploading" && (
                <button
                  onClick={() => cancelUpload(upload.id)}
                  className="ml-auto text-[var(--text-tertiary)] hover:text-red-500 transition-colors text-xs"
                  title="Cancelar upload"
                >
                  Cancelar
                </button>
              )}
            </div>

            <div className="relative w-full h-1.5 bg-[var(--color-base-alt)] rounded-full overflow-hidden mt-1.5">
              {upload.status === "uploading" && upload.progress != null && (
                <div
                  className="absolute inset-y-0 left-0 bg-[var(--color-primary)] rounded-full transition-all duration-300"
                  style={{ width: `${upload.progress}%` }}
                />
              )}
              {upload.status === "queued" && (
                <div className="absolute inset-0 bg-amber-500/60 animate-progress-indeterminate" />
              )}
              {upload.status === "processing" && (
                <div className="absolute inset-0 bg-[var(--color-primary)] animate-progress-indeterminate" />
              )}
              {upload.status === "failed" && <div className="absolute inset-0 bg-red-500/50" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
