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
}: ConfirmDialogProps) {
  // Telegram BackButton
  useEffect(() => {
    if (!isOpen) return;
    showBackButton(onCancel);
    return () => hideBackButton();
  }, [isOpen, onCancel]);

  const handleConfirm = () => {
    hapticSuccess();
    onConfirm();
  };

  const handleCancel = () => {
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
          <button type="button" onClick={handleCancel} className="gnome-btn-secondary text-sm">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`text-sm font-medium ${
              variant === "danger" ? "gnome-btn-danger" : "gnome-btn-primary"
            }`}
          >
            {confirmLabel}
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
