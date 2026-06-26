import { useState, useCallback, useRef, useEffect } from "react";

interface UndoToast {
  id: number;
  message: string;
  onUndo?: () => void;
  type: "undo" | "info";
}

let toastId = 0;

export function useUndoToast() {
  const [toasts, setToasts] = useState<UndoToast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Listen for global toast events
  useEffect(() => {
    const handleToast = (e: CustomEvent<{ message: string; type: string; duration: number }>) => {
      const { message, type, duration } = e.detail;
      const id = ++toastId;

      const removeToast = () => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timersRef.current.delete(id);
      };

      const timer = setTimeout(removeToast, duration);
      timersRef.current.set(id, timer);

      setToasts((prev) => [...prev, { id, message, type: type === "undo" ? "undo" : "info" }]);
    };

    window.addEventListener("show-toast", handleToast as EventListener);
    return () => window.removeEventListener("show-toast", handleToast as EventListener);
  }, []);

  const show = useCallback(
    (message: string, onConfirm: () => void, onUndo?: () => void, duration = 5000) => {
      const id = ++toastId;

      const removeToast = () => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timersRef.current.delete(id);
      };

      const handleUndo = () => {
        const timer = timersRef.current.get(id);
        if (timer) clearTimeout(timer);
        removeToast();
        onUndo?.();
      };

      const handleConfirm = () => {
        removeToast();
        onConfirm();
      };

      const timer = setTimeout(handleConfirm, duration);
      timersRef.current.set(id, timer);

      setToasts((prev) => [...prev, { id, message, onUndo: handleUndo, type: "undo" }]);
    },
    [],
  );

  const showInfo = useCallback((message: string, duration = 4000) => {
    const id = ++toastId;

    const removeToast = () => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    };

    const timer = setTimeout(removeToast, duration);
    timersRef.current.set(id, timer);

    setToasts((prev) => [...prev, { id, message, type: "info" }]);
  }, []);

  const ToastContainer =
    toasts.length > 0 ? (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex items-center gap-3 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg px-4 py-3 shadow-lg text-sm text-[var(--text-primary)] animate-modal-content"
          >
            <span>{toast.message}</span>
            {toast.type === "undo" && toast.onUndo && (
              <button
                onClick={toast.onUndo}
                className="font-semibold text-[var(--color-primary)] hover:underline whitespace-nowrap"
              >
                Deshacer
              </button>
            )}
          </div>
        ))}
      </div>
    ) : <></>;

  return { show, showInfo, ToastContainer };
}
