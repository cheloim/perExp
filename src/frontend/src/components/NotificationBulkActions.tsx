import { useState } from "react";
import { useNotifications } from "../context/NotificationsContext";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  /** Panel headers are cramped; page toolbars have room for the count. */
  compact?: boolean;
}

/** "Marcar todo leído" + "Limpiar leídas", with the confirmation it needs. */
export default function NotificationBulkActions({ compact = false }: Props) {
  const { notifications, markAllRead, deleteAllRead, deleteAll } = useNotifications();
  const [confirmClearRead, setConfirmClearRead] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

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
      {notifications.length > 0 && (
        <button
          onClick={() => setConfirmDeleteAll(true)}
          className={`text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10 ${
            compact ? "" : "px-3 py-1.5 rounded-md border border-red-500/40"
          }`}
        >
          Eliminar todas
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

      <ConfirmDialog
        isOpen={confirmDeleteAll}
        title="Eliminar todas las notificaciones"
        message={
          <>
            Se eliminarán {notifications.length} notificación
            {notifications.length !== 1 ? "es" : ""}, incluidas las no leídas y las invitaciones
            pendientes. Esta acción no se puede deshacer.
          </>
        }
        confirmLabel="Eliminar"
        onConfirm={() => {
          void deleteAll();
          setConfirmDeleteAll(false);
        }}
        onCancel={() => setConfirmDeleteAll(false)}
      />
    </>
  );
}
