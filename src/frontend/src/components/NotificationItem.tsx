import SymbolicIcon from "./SymbolicIcon";
import type { Notification } from "../types";
import {
  getNotifActionLabel,
  getNotifBorderColor,
  getNotifIcon,
  resolveNotificationTarget,
} from "../utils/notifications";

interface Props {
  notification: Notification;
  /** Already formatted, e.g. "Hace 5m". */
  timeLabel: string;
  onActivate: (n: Notification) => void;
  onDelete: (n: Notification) => void;
  onAccept: (n: Notification) => void;
  onReject: (n: Notification) => void;
  rejectPending?: boolean;
  /** Panel rows are tight; page rows are cards with room to breathe. */
  variant?: "panel" | "page";
}

/**
 * One notification. The message is shown in full — never clamped, never
 * ellipsised: a notification whose body is cut hides exactly the detail it was
 * sent for.
 */
export default function NotificationItem({
  notification: n,
  timeLabel,
  onActivate,
  onDelete,
  onAccept,
  onReject,
  rejectPending = false,
  variant = "panel",
}: Props) {
  const { icon, color } = getNotifIcon(n);
  const borderColor = getNotifBorderColor(n);
  const actionLabel = getNotifActionLabel(n);
  const isClickable = resolveNotificationTarget(n) !== null;
  const isPage = variant === "page";

  // A pending invitation is one the user can still answer: once it is read, it
  // is history and the buttons would be a lie.
  const hasPendingInvite = n.type === "group_invitation" && !!n.data.member_id && !n.read;

  return (
    <div
      onClick={() => isClickable && onActivate(n)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && isClickable) {
          e.preventDefault();
          onActivate(n);
        }
      }}
      className={[
        isPage ? "px-5 py-4 rounded-lg border border-[var(--border-color)]" : "px-4 py-3",
        !n.read ? "bg-[var(--color-primary)]/8" : isPage ? "bg-[var(--color-surface)]" : "",
        isClickable ? "cursor-pointer hover:bg-[var(--color-base-alt)] transition-colors" : "",
        borderColor ? `border-l-4 ${borderColor}` : "",
      ].join(" ")}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? `${n.title}. ${actionLabel}` : undefined}
    >
      <div className="flex items-start gap-2.5">
        <span className="flex-shrink-0 mt-0.5">
          <SymbolicIcon name={icon} size={isPage ? 18 : 16} className={color} />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <p
              className={`text-[var(--text-primary)] font-medium leading-tight break-words ${
                isPage ? "text-base" : "text-sm"
              }`}
            >
              {n.title}
            </p>
            <span className="text-[var(--text-tertiary)] text-xs whitespace-nowrap flex-shrink-0">
              {timeLabel}
            </span>
          </div>

          <p
            className={`text-[var(--text-secondary)] whitespace-pre-line break-words mb-1.5 ${
              isPage ? "text-sm leading-relaxed" : "text-xs"
            }`}
          >
            {n.body}
          </p>

          {actionLabel && (
            <p className="text-[var(--color-primary)] text-xs font-medium">{actionLabel}</p>
          )}

          {hasPendingInvite && (
            <div className="flex gap-2 mt-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAccept(n);
                }}
                className="text-xs px-3 py-1 rounded-md bg-[var(--color-primary)] hover:brightness-110 text-white transition-colors"
              >
                ✓ Aceptar
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReject(n);
                }}
                disabled={rejectPending}
                className="text-xs px-3 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition-colors disabled:opacity-50"
              >
                ✕ Rechazar
              </button>
            </div>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(n);
          }}
          className="flex-shrink-0 text-[var(--text-tertiary)] hover:text-red-500 transition-colors p-0.5"
          title="Eliminar notificación"
          aria-label={`Eliminar notificación: ${n.title}`}
        >
          <SymbolicIcon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}
