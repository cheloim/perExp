/**
 * Everything the notification UI needs to know about a notification: what it
 * looks like, and where activating it takes the user.
 *
 * The destination map lives here, on its own, so that a new notification type
 * cannot ship with a dead button — `notifications.test.ts` asserts that every
 * notification with an action label really has somewhere to go.
 */
import type { Notification } from "../types";
import type { IconName } from "../components/SymbolicIcon";

/** What activating a notification does. */
export type NotificationTarget =
  { kind: "navigate"; path: string } | { kind: "download"; month: string };

function dataOf(n: Notification): Record<string, unknown> {
  return (n.data ?? {}) as Record<string, unknown>;
}

/** "Hace 5m" — how long ago a notification arrived. */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "Ahora";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora";
  if (mins < 60) return `Hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  return `Hace ${Math.floor(hours / 24)}d`;
}

/**
 * Where a notification takes the user, or null when it has nowhere to go and
 * is handled by its own inline buttons (a group invitation) or by nothing yet
 * (a report still being generated).
 */
export function resolveNotificationTarget(n: Notification): NotificationTarget | null {
  const data = dataOf(n);

  switch (n.type) {
    case "import_ready":
    case "import_failed": {
      const jobId = typeof data.job_id === "number" ? data.job_id : undefined;
      return jobId ? { kind: "navigate", path: `/import-jobs/${jobId}` } : null;
    }
    case "uncategorized_expense":
    case "uncategorized_expenses":
      return { kind: "navigate", path: "/expenses?uncategorized=1" };
    case "category_suggestions":
      return { kind: "navigate", path: "/expenses?category_suggestions=1" };
    case "auto_recurring_detected":
      return { kind: "navigate", path: "/installments?filter=recurring" };
    case "budget_warning":
      // #455: this pointed at /budgets, which has no route — every "Ver
      // presupuestos" click landed on the not-found page.
      return { kind: "navigate", path: "/budget" };
    case "whats_new": {
      const version = typeof data.version === "string" ? data.version : undefined;
      return version ? { kind: "navigate", path: `/changes/${version}` } : null;
    }
    case "monthly_report_ready": {
      const month = typeof data.month === "string" ? data.month : undefined;
      return month ? { kind: "download", month } : null;
    }
    default:
      return null;
  }
}

/** The label under the message. Null when the notification has no destination. */
export function getNotifActionLabel(n: Notification): string | null {
  if (!resolveNotificationTarget(n)) return null;

  switch (n.type) {
    case "import_ready":
    case "import_failed":
      return "Ver importación →";
    case "uncategorized_expense":
    case "uncategorized_expenses":
      return "Ver gastos sin categoría →";
    case "category_suggestions":
      return "Ver sugerencias →";
    case "auto_recurring_detected":
      return "Ver programados →";
    case "budget_warning":
      return "Ver presupuestos →";
    case "whats_new":
      return "Ver novedades →";
    case "monthly_report_ready":
      return "Descargar reporte →";
    default:
      return null;
  }
}

/** Icon and colour for a notification type. */
export function getNotifIcon(n: Notification): { icon: IconName; color: string } {
  switch (n.type) {
    case "import_ready":
      return { icon: "check", color: "text-green-500" };
    case "import_failed":
      return { icon: "warning", color: "text-red-500" };
    case "uncategorized_expense":
    case "uncategorized_expenses":
      return { icon: "warning", color: "text-amber-500" };
    case "category_suggestions":
      return { icon: "sparkles", color: "text-purple-500" };
    case "auto_recurring_detected":
      return { icon: "installments", color: "text-indigo-500" };
    case "budget_warning":
      return {
        icon: "warning",
        color: dataOf(n).status === "exceeded" ? "text-red-500" : "text-amber-500",
      };
    case "monthly_report_ready":
    case "monthly_report_queued":
      return { icon: "book", color: "text-blue-500" };
    case "whats_new":
      return { icon: "sparkles", color: "text-[var(--color-primary)]" };
    case "group_invitation":
      return { icon: "users", color: "text-[var(--color-primary)]" };
    default:
      return { icon: "bell", color: "text-[var(--text-tertiary)]" };
  }
}

/** Left accent border for a notification type. Empty when the type has none. */
export function getNotifBorderColor(n: Notification): string {
  switch (n.type) {
    case "import_ready":
      return "border-l-green-500";
    case "import_failed":
      return "border-l-red-500";
    case "uncategorized_expense":
    case "uncategorized_expenses":
      return "border-l-amber-500";
    case "category_suggestions":
      return "border-l-purple-500";
    case "auto_recurring_detected":
      return "border-l-indigo-500";
    case "budget_warning":
      return dataOf(n).status === "exceeded" ? "border-l-red-500" : "border-l-amber-500";
    case "monthly_report_ready":
    case "monthly_report_queued":
      return "border-l-blue-500";
    case "whats_new":
      return "border-l-[var(--color-primary)]";
    default:
      return "";
  }
}
