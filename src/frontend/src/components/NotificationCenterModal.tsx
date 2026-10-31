import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useNotifications } from "../context/NotificationsContext";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { hideBackButton, showBackButton } from "../services/telegramWebApp";
import type { Notification } from "../types";
import NotificationsList from "./NotificationsList";
import SymbolicIcon from "./SymbolicIcon";

type Filter = "all" | "unread";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOpenDetail: (notification: Notification) => void;
}

/**
 * The notification center over the page the user was on. The /notifications
 * route stays for deep links; this is the quick, in-place entry point.
 */
export default function NotificationCenterModal({ isOpen, onClose, onOpenDetail }: Props) {
  const { notifications, unreadCount, connected } = useNotifications();
  const [filter, setFilter] = useState<Filter>("all");
  const trapRef = useFocusTrap(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return;
    showBackButton(onClose);
    return () => hideBackButton();
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const visible = filter === "unread" ? notifications.filter((n) => !n.read) : notifications;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-backdrop bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-center-title"
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)] shadow-xl animate-modal-content"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] px-5 py-4">
          <div>
            <h2
              id="notification-center-title"
              className="text-base font-semibold text-[var(--text-primary)]"
            >
              Notificaciones
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
              {notifications.length === 0
                ? "No tenés notificaciones"
                : unreadCount > 0
                  ? `${unreadCount} sin leer de ${notifications.length}`
                  : `Todas leídas · ${notifications.length} en total`}
            </p>
          </div>
          <button
            autoFocus
            type="button"
            onClick={onClose}
            aria-label="Cerrar notificaciones"
            className="flex-shrink-0 rounded-md p-1 text-xl leading-none text-[var(--text-tertiary)] transition-colors hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)]"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!connected && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--color-primary)]/5 px-4 py-2.5">
              <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              <p className="text-xs text-[var(--text-tertiary)]">Conectando...</p>
            </div>
          )}

          {notifications.length > 0 && (
            <div className="mb-4 inline-flex rounded-lg border border-[var(--border-color)] p-0.5">
              {(
                [
                  ["all", "Todas"],
                  ["unread", "Sin leer"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    filter === key
                      ? "bg-[var(--color-base-alt)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-color)] px-4 py-12">
              <SymbolicIcon
                name="bell"
                size={40}
                className="mb-3 text-[var(--text-tertiary)] opacity-40"
              />
              <p className="text-sm font-medium text-[var(--text-secondary)]">¡Todo al día! ✨</p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                No tenés notificaciones pendientes
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-color)] px-4 py-12">
              <SymbolicIcon name="check" size={40} className="mb-3 text-green-500 opacity-50" />
              <p className="text-sm font-medium text-[var(--text-secondary)]">Sin leer</p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Ya leíste todas tus notificaciones
              </p>
            </div>
          ) : (
            <NotificationsList variant="page" filter={filter} onOpenDetail={onOpenDetail} />
          )}
        </div>

        <footer className="border-t border-[var(--border-color)] px-5 py-3">
          <Link
            to="/notifications"
            onClick={onClose}
            className="text-sm font-medium text-[var(--color-primary)] hover:underline"
          >
            Ver todas las notificaciones →
          </Link>
        </footer>
      </div>
    </div>
  );
}
