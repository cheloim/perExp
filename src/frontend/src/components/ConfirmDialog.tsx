import { useEffect } from "react";
import { ReactNode } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import {
  showBackButton,
  hideBackButton,
  hapticSuccess,
  hapticLight,
} from "../services/telegramWebApp";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "primary";
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
  variant = "danger",
}: ConfirmDialogProps) {
  const trapRef = useFocusTrap(isOpen, onCancel);

  // Telegram BackButton
  useEffect(() => {
    if (!isOpen) return;
    showBackButton(onCancel);
    return () => hideBackButton();
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    hapticSuccess();
    onConfirm();
  };

  const handleCancel = () => {
    hapticLight();
    onCancel();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-backdrop bg-black/60"
      onClick={handleCancel}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby="confirm-dialog-message"
        className="relative bg-[var(--color-surface)] border border-[var(--border-color)] rounded-md shadow-xl w-full max-w-sm p-4 space-y-4 animate-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          <p id="confirm-dialog-message" className="text-sm text-[var(--text-secondary)]">
            {message}
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={handleCancel} autoFocus className="gnome-btn-secondary text-sm">
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            className={`text-sm font-medium ${
              variant === "danger" ? "gnome-btn-danger" : "gnome-btn-primary"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
