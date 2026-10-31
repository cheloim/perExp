import { useState } from "react";
import { useNotifications } from "../context/NotificationsContext";
import NotificationBulkActions from "../components/NotificationBulkActions";
import NotificationsList from "../components/NotificationsList";
import SymbolicIcon from "../components/SymbolicIcon";

type Filter = "all" | "unread";

/**
 * The notification archive — the place where a message can be read whole.
 *
 * The popover is for glancing; this is for reading and for cleaning up. It
 * exists because #455 had nowhere for a long message to live.
 */
export default function NotificationsPage() {
  const { notifications, connected, openDetail } = useNotifications();
  const [filter, setFilter] = useState<Filter>("all");

  const unread = notifications.filter((n) => !n.read).length;
  const visible = filter === "unread" ? unread : notifications.length;

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">
            Notificaciones
          </h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">
            {notifications.length === 0
              ? "No tenés notificaciones"
              : unread > 0
                ? `${unread} sin leer de ${notifications.length}`
                : `Todas leídas · ${notifications.length} en total`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NotificationBulkActions />
        </div>
      </div>

      {!connected && (
        <div className="flex items-center gap-2 px-4 py-2.5 mb-4 rounded-lg bg-[var(--color-primary)]/5 border border-[var(--border-color)]">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <p className="text-[var(--text-tertiary)] text-xs">Conectando...</p>
        </div>
      )}

      {notifications.length > 0 && (
        <div className="inline-flex rounded-lg border border-[var(--border-color)] p-0.5 mb-4">
          {(
            [
              ["all", "Todas"],
              ["unread", "Sin leer"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
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
        <div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-dashed border-[var(--border-color)]">
          <SymbolicIcon
            name="bell"
            size={44}
            className="text-[var(--text-tertiary)] opacity-40 mb-3"
          />
          <p className="text-[var(--text-secondary)] text-base font-medium">¡Todo al día! ✨</p>
          <p className="text-[var(--text-tertiary)] text-sm mt-1">
            No tenés notificaciones pendientes
          </p>
        </div>
      ) : visible === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-dashed border-[var(--border-color)]">
          <SymbolicIcon name="check" size={44} className="text-green-500 opacity-50 mb-3" />
          <p className="text-[var(--text-secondary)] text-base font-medium">Sin leer</p>
          <p className="text-[var(--text-tertiary)] text-sm mt-1">
            Ya leíste todas tus notificaciones
          </p>
        </div>
      ) : (
        <NotificationsList variant="page" filter={filter} onOpenDetail={openDetail} />
      )}
    </div>
  );
}
