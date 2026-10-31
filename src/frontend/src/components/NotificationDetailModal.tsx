import { useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { hideBackButton, showBackButton } from "../services/telegramWebApp";
import type { Notification } from "../types";
import {
  getNotifActionLabel,
  getNotifIcon,
  resolveNotificationTarget,
  timeAgo,
} from "../utils/notifications";
import SymbolicIcon from "./SymbolicIcon";

interface Props {
  notification: Notification | null;
  onClose: () => void;
  onAction: (notification: Notification) => void;
  /** The list behind the modal sits at z-50; this one goes above it. */
  zClassName?: string;
}

/**
 * The notification detail. It shows the whole message over the page the user
 * was on, and only navigates when the user presses the action button.
 */
export default function NotificationDetailModal({
  notification,
  onClose,
  onAction,
  zClassName = "z-[60]",
}: Props) {
  const isOpen = notification !== null;
  const trapRef = useFocusTrap(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return;
    showBackButton(onClose);
    return () => hideBackButton();
  }, [isOpen, onClose]);

  if (!notification) return null;

  const { icon, color } = getNotifIcon(notification);
  const actionLabel = getNotifActionLabel(notification);
  const target = resolveNotificationTarget(notification);

  return (
    <div
      className={`fixed inset-0 ${zClassName} flex items-center justify-center p-4 animate-modal-backdrop bg-black/50 backdrop-blur-sm`}
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-detail-title"
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)] shadow-xl animate-modal-content"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-[var(--border-color)] px-5 py-4">
          <span
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-base-alt)] ${color}`}
          >
            <SymbolicIcon name={icon} size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="notification-detail-title"
              className="break-words text-base font-semibold text-[var(--text-primary)]"
            >
              {notification.title}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
              {timeAgo(notification.created_at)}
            </p>
          </div>
          <button
            autoFocus
            type="button"
            onClick={onClose}
            aria-label="Cerrar notificación"
            className="flex-shrink-0 rounded-md p-1 text-lg leading-none text-[var(--text-tertiary)] transition-colors hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)]"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          <p className="whitespace-pre-line break-words text-sm leading-relaxed text-[var(--text-secondary)]">
            {notification.body}
          </p>
        </div>

        {actionLabel && target && (
          <footer className="border-t border-[var(--border-color)] px-5 py-4">
            <button
              type="button"
              onClick={() => {
                onAction(notification);
                onClose();
              }}
              className="gnome-btn-primary w-full text-sm"
            >
              {actionLabel}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
