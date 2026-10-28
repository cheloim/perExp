import { useState } from "react";
import { useNotifications } from "../context/NotificationsContext";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  /** Panel headers are cramped; page toolbars have room for the count. */
  compact?: boolean;
}

/** "Marcar todo leído" + "Limpiar leídas", with the confirmation it needs. */
export default function NotificationBulkActions({ compact = false }: Props) {
  const { notifications, markAllRead, deleteAllRead } = useNotifications();
  const [confirmClearRead, setConfirmClearRead] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const readCount = notifications.filter((n) => n.read).length;

  return (
    <>
      {unreadCount > 0 && (
        <button
          onClick={() => markAllRead()}
          className={`text-xs text-[var(--color-primary)] hover:underline transition-colors ${
            compact ? "" : "px-3 py-1.5 rounded-md border border-[var(--border-color)]"
          }`}
        >
          Marcar todo leído
        </button>
      )}
      {readCount > 0 && (
        <button
          onClick={() => setConfirmClearRead(true)}
          className={`text-xs text-[var(--text-tertiary)] hover:text-red-500 transition-colors ${
            compact ? "" : "px-3 py-1.5 rounded-md border border-[var(--border-color)]"
          }`}
        >
          Limpiar leídas
        </button>
      )}

      <ConfirmDialog
        isOpen={confirmClearRead}
        title="Limpiar notificaciones leídas"
        message={
          <>
            Se eliminarán {readCount} notificación{readCount !== 1 ? "es" : ""} leída
            {readCount !== 1 ? "s" : ""}. Esta acción no se puede deshacer.
          </>
        }
        confirmLabel="Eliminar"
        onConfirm={() => {
          deleteAllRead();
          setConfirmClearRead(false);
        }}
        onCancel={() => setConfirmClearRead(false)}
      />
    </>
  );
}
