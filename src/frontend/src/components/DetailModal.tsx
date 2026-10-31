import { useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
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

const SIZE_CLASS: Record<NonNullable<DetailModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

export function DetailModal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "lg",
}: DetailModalProps) {
  const trapRef = useFocusTrap(isOpen);

  // Telegram BackButton
  useEffect(() => {
    if (!isOpen) return;
    showBackButton(onClose);
    return () => hideBackButton();
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-backdrop bg-black/60"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-xl w-full ${SIZE_CLASS[size]} max-h-[90vh] overflow-hidden flex flex-col animate-modal-content`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div className="min-w-0 flex-1">
            <h2
              className="text-base font-semibold truncate"
              style={{ color: "var(--text-primary)" }}
            >
              {title}
            </h2>
            {subtitle && <p className="text-xs text-[var(--text-tertiary)]">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="ml-3 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xl flex-shrink-0"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-[var(--border-color)] flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
