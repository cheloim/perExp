import { useEffect } from "react";
import { ReactNode } from "react";
import Dialog from "./ui/Dialog";
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
  /** The action is in flight: both buttons stay disabled until it settles. */
  pending?: boolean;
}

/**
 * Confirmation prompt built on the shared Dialog, so it inherits the focus
 * trap, Escape handling, focus restoration and `inert` background.
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
  variant = "danger",
  pending = false,
}: ConfirmDialogProps) {
  // Telegram BackButton
  useEffect(() => {
    if (!isOpen) return;
    showBackButton(onCancel);
    return () => hideBackButton();
  }, [isOpen, onCancel]);

  const handleConfirm = () => {
    if (pending) return;
    hapticSuccess();
    onConfirm();
  };

  const handleCancel = () => {
    if (pending) return;
    hapticLight();
    onCancel();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleCancel}
      title={title}
      description={typeof message === "string" ? message : undefined}
      size="sm"
      footer={
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className="gnome-btn-secondary text-sm disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            aria-busy={pending}
            className={`text-sm font-medium disabled:opacity-50 ${
              variant === "danger" ? "gnome-btn-danger" : "gnome-btn-primary"
            }`}
          >
            {pending ? "Procesando…" : confirmLabel}
          </button>
        </div>
      }
    >
      {typeof message !== "string" && (
        <div className="text-sm text-[var(--text-secondary)]">{message}</div>
      )}
    </Dialog>
  );
}
