import { useCallback, useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const SIZE_CLASS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
} as const;

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  title: string;
  /** Optional supporting text linked with `aria-describedby`. */
  description?: string;
  children: ReactNode;
  /** Fixed action row below the scrollable body. */
  footer?: ReactNode;
  size?: keyof typeof SIZE_CLASS;
  /** Accessible name for the close button. */
  closeLabel?: string;
  className?: string;
}

/**
 * Modal dialog with the accessibility contract the ad-hoc modals keep missing:
 * `role="dialog"`, `aria-modal`, an accessible title, focus trap, Escape to
 * close, focus restoration to the trigger and `inert` on the background.
 *
 * It reuses `useFocusTrap`; there is no second focus-trap implementation.
 */
export default function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = "lg",
  closeLabel = "Cerrar",
  className = "",
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  /*
   * Registered before the trap effect on purpose: effect cleanups run in the
   * same order they were registered, so `inert` is removed *before* the trap
   * restores focus. Focusing an element inside an inert subtree is a no-op in
   * browsers, which would silently lose the returning focus.
   *
   * The focused trigger is still the active element when this effect runs, so
   * the trap can capture it right after.
   */
  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const siblings = Array.from(document.body.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child !== dialog && !child.contains(dialog),
    );
    const wasInert = siblings.map((child) => child.hasAttribute("inert"));

    for (const sibling of siblings) sibling.setAttribute("inert", "");

    return () => {
      siblings.forEach((sibling, index) => {
        if (!wasInert[index]) sibling.removeAttribute("inert");
      });
    };
  }, [isOpen]);

  const trapRef = useFocusTrap(isOpen, onClose);

  useEffect(() => {
    if (isOpen) dialogRef.current?.focus();
  }, [isOpen]);

  const setDialogRef = useCallback(
    (node: HTMLDivElement | null) => {
      dialogRef.current = node;
      trapRef.current = node;
    },
    [trapRef],
  );

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-backdrop bg-black/60"
      onClick={onClose}
    >
      <div
        ref={setDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--color-surface)] shadow-xl animate-modal-content focus:outline-none ${SIZE_CLASS[size]} ${className}`.trim()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="truncate text-base font-semibold text-[var(--text-primary)]"
            >
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-xs text-[var(--text-tertiary)]">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex-shrink-0 text-xl text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex-shrink-0 border-t border-[var(--border-color)] px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
