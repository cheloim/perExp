import { useEffect } from "react";
import Dialog from "./ui/Dialog";
import { showBackButton, hideBackButton } from "../services/telegramWebApp";

interface DetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Fixed action row below the scroll area. */
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

/**
 * Detail surface used across the app. It delegates the modal contract
 * (`role="dialog"`, focus trap, focus restoration and `inert` background) to
 * the shared Dialog primitive; the Telegram back button is the only extra.
 */
export function DetailModal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "lg",
}: DetailModalProps) {
  // Telegram BackButton
  useEffect(() => {
    if (!isOpen) return;
    showBackButton(onClose);
    return () => hideBackButton();
  }, [isOpen, onClose]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={subtitle}
      footer={footer}
      size={size}
    >
      {children}
    </Dialog>
  );
}
