import { useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface DetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function DetailModal({ isOpen, onClose, title, subtitle, children }: DetailModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const trapRef = useFocusTrap(true);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div ref={trapRef} role="dialog" aria-modal="true" aria-label={title} className="relative bg-[var(--color-surface)] border border-[var(--border-color)] rounded-t-lg sm:rounded-lg shadow-xl w-full sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-modal-content">
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
      </div>
    </div>
  );
}
