import { useSyncExternalStore } from "react";
import {
  dismissToast,
  getToasts,
  pauseToast,
  resumeToast,
  subscribeToasts,
  type ToastRecord,
} from "../utils/toast";

function KindIcon({ kind }: { kind: ToastRecord["kind"] }) {
  const color =
    kind === "success"
      ? "text-green-500"
      : kind === "error"
        ? "text-red-500"
        : "text-[var(--color-primary)]";

  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      className={`flex-shrink-0 ${color}`}
    >
      {kind === "success" ? (
        <>
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M5 8.2l2 2 4-4.2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : kind === "error" ? (
        <>
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8 4.5v4M8 10.8v0.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8 7.2v4M8 4.6v0.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

function ToastCard({ toast }: { toast: ToastRecord }) {
  return (
    <div
      onMouseEnter={() => pauseToast(toast.id)}
      onMouseLeave={() => resumeToast(toast.id)}
      onFocus={() => pauseToast(toast.id)}
      onBlur={() => resumeToast(toast.id)}
      className={`flex items-start gap-3 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-lg text-sm text-[var(--text-primary)] animate-modal-content ${
        toast.body || toast.action ? "px-4 py-3 w-full" : "px-4 py-3"
      }`}
    >
      {toast.kind !== "undo" && <KindIcon kind={toast.kind} />}

      <div className="flex-1 min-w-0">
        <p className="font-medium break-words">{toast.message}</p>
        {toast.body && (
          <p className="text-[var(--text-secondary)] text-xs mt-0.5 whitespace-pre-line break-words">
            {toast.body}
          </p>
        )}
        {toast.action && (
          <button
            onClick={() => {
              dismissToast(toast.id);
              toast.action?.onClick();
            }}
            className="mt-1.5 text-xs font-semibold text-[var(--color-primary)] hover:underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>

      {toast.kind === "undo" ? (
        toast.onUndo && (
          <button
            onClick={() => {
              dismissToast(toast.id);
              toast.onUndo?.();
            }}
            className="font-semibold text-[var(--color-primary)] hover:underline whitespace-nowrap"
          >
            Deshacer
          </button>
        )
      ) : (
        <button
          onClick={() => dismissToast(toast.id)}
          aria-label="Cerrar aviso"
          className="flex-shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * Where toasts appear. Rendered exactly once, in `App` — the store guarantees
 * one copy of each toast, this guarantees one place to draw them.
 */
export default function ToastViewport() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);

  const bottomToasts = toasts.filter((t) => t.position === "bottom-center");
  const topRightToasts = toasts.filter((t) => t.position === "top-right");

  return (
    <>
      {bottomToasts.length > 0 && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center"
          role="status"
          aria-live="polite"
        >
          {bottomToasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} />
          ))}
        </div>
      )}

      {topRightToasts.length > 0 && (
        <div
          className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]"
          role="alert"
          aria-live="assertive"
        >
          {topRightToasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} />
          ))}
        </div>
      )}
    </>
  );
}
