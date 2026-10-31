import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { deleteImportJob, downloadReportPdf, rejectGroupInvitation } from "../api/client";
import { useNotifications } from "../context/NotificationsContext";
import type { Notification } from "../types";
import { resolveNotificationTarget, timeAgo } from "../utils/notifications";
import { showToast } from "../utils/toast";
import { ConfirmDialog } from "./ConfirmDialog";
import InvitationDisclaimer from "./InvitationDisclaimer";
import NotificationItem from "./NotificationItem";

interface Props {
  variant: "panel" | "page";
  /** Which notifications to show. */
  filter?: "all" | "unread";
  /** Called after a notification is activated — the panel uses it to close. */
  onAfterActivate?: () => void;
  /** When present, activating a row opens its detail instead of navigating. */
  onOpenDetail?: (notification: Notification) => void;
}

/**
 * The notification list and everything that happens to a notification: where
 * activating it goes, and the confirmations the destructive actions need.
 *
 * Shared by the popover and the /notifications page so the two cannot drift
 * apart in behaviour.
 */
export default function NotificationsList({
  variant,
  filter = "all",
  onAfterActivate,
  onOpenDetail,
}: Props) {
  const navigate = useNavigate();
  const { notifications, markRead, deleteNotification } = useNotifications();
  const visible = filter === "unread" ? notifications.filter((n) => !n.read) : notifications;

  const [disclaimer, setDisclaimer] = useState<{
    notifId: number;
    inviterName: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    jobId: number;
    notifId: number;
  } | null>(null);
  const [confirmReject, setConfirmReject] = useState<number | null>(null);
  const [, setTick] = useState(0);

  // The relative timestamps say "Hace 5m" — they have to age on their own.
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const reject = useMutation({
    mutationFn: rejectGroupInvitation,
    onSuccess: (_data, notifId) => {
      // The server only marks it read; without this the buttons stay live on
      // an invitation that has already been answered.
      void markRead(notifId);
      setConfirmReject(null);
    },
    onError: () => {
      showToast("No se pudo rechazar la invitación", "error", 5000, "bottom-center");
      setConfirmReject(null);
    },
  });

  const handleActivate = (n: Notification) => {
    const target = resolveNotificationTarget(n);
    if (!target) return;

    if (onOpenDetail) {
      // The opener marks it read and shows the detail over the current page.
      onOpenDetail(n);
      onAfterActivate?.();
      return;
    }

    void markRead(n.id);
    if (target.kind === "download") {
      downloadReportPdf(target.month);
    } else {
      navigate(target.path);
    }
    onAfterActivate?.();
  };

  const handleDelete = (n: Notification) => {
    if (n.type === "import_ready" || n.type === "import_failed") {
      const jobId = typeof n.data.job_id === "number" ? n.data.job_id : undefined;
      // Deleting an import notification takes the job down with it, so it gets
      // the confirmation. A notification on its own is deleted in one click.
      if (jobId) setConfirmDelete({ jobId, notifId: n.id });
      return;
    }
    void deleteNotification(n.id);
  };

  const handleDeleteJob = async (jobId: number, notifId: number) => {
    try {
      await deleteImportJob(jobId);
      await deleteNotification(notifId);
    } catch (err) {
      console.error("[NotificationsList] deleteImportJob failed", err);
      showToast("No se pudo eliminar la importación", "error", 5000, "bottom-center");
    }
  };

  const handleAccept = (n: Notification) => {
    const inviterName =
      ("inviter_name" in n.data ? (n.data.inviter_name as string) : undefined) || "el invitante";
    setDisclaimer({ notifId: n.id, inviterName });
  };

  return (
    <>
      <div className={variant === "page" ? "space-y-3" : ""}>
        {visible.map((n) => (
          <NotificationItem
            key={n.id}
            notification={n}
            variant={variant}
            timeLabel={timeAgo(n.created_at)}
            onActivate={handleActivate}
            onDelete={handleDelete}
            onAccept={handleAccept}
            onReject={(x) => setConfirmReject(x.id)}
            rejectPending={reject.isPending}
            alwaysClickable={Boolean(onOpenDetail) && n.type !== "group_invitation"}
          />
        ))}
      </div>

      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title="Eliminar importación"
        message="Se eliminará la importación y su notificación. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (confirmDelete) void handleDeleteJob(confirmDelete.jobId, confirmDelete.notifId);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        isOpen={confirmReject !== null}
        title="Rechazar invitación"
        message="¿Seguro que querés rechazar esta invitación? No podrás unirte a este grupo más adelante a menos que te vuelvan a invitar."
        confirmLabel="Rechazar"
        onConfirm={() => {
          // No busy state on the dialog, so guard against a second click here.
          if (confirmReject !== null && !reject.isPending) reject.mutate(confirmReject);
        }}
        onCancel={() => setConfirmReject(null)}
      />

      {disclaimer && (
        <InvitationDisclaimer
          notificationId={disclaimer.notifId}
          inviterName={disclaimer.inviterName}
          onClose={() => setDisclaimer(null)}
        />
      )}
    </>
  );
}
