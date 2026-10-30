import { describe, it, expect } from "vitest";
import type { Notification } from "../types";
import { resolveNotificationTarget, getNotifActionLabel, getNotifIcon } from "./notifications";

function notif(over: Partial<Notification> & { type: string }): Notification {
  return {
    id: 1,
    title: "Título",
    body: "Cuerpo",
    read: false,
    created_at: new Date().toISOString(),
    data: {},
    ...over,
  } as Notification;
}

describe("resolveNotificationTarget", () => {
  it("sends budget warnings to /budget — #455 sent them to /budgets, a route that does not exist", () => {
    const target = resolveNotificationTarget(
      notif({ type: "budget_warning", data: { status: "exceeded" } }),
    );
    expect(target).toEqual({ kind: "navigate", path: "/budget" });
  });

  it("sends uncategorized expenses to the expenses list", () => {
    expect(resolveNotificationTarget(notif({ type: "uncategorized_expenses" }))).toEqual({
      kind: "navigate",
      path: "/expenses?uncategorized=1",
    });
  });

  it("sends category suggestions to the expenses list", () => {
    expect(resolveNotificationTarget(notif({ type: "category_suggestions" }))).toEqual({
      kind: "navigate",
      path: "/expenses?category_suggestions=1",
    });
  });

  it("sends detected recurring expenses to the scheduled list", () => {
    expect(resolveNotificationTarget(notif({ type: "auto_recurring_detected" }))).toEqual({
      kind: "navigate",
      path: "/installments?filter=recurring",
    });
  });

  it("sends an import notification to its job", () => {
    expect(
      resolveNotificationTarget(notif({ type: "import_ready", data: { job_id: 42 } })),
    ).toEqual({ kind: "navigate", path: "/import-jobs/42" });
  });

  it("has nowhere to send an import notification without a job id", () => {
    expect(resolveNotificationTarget(notif({ type: "import_ready", data: {} }))).toBeNull();
  });

  it("downloads a ready monthly report instead of navigating", () => {
    expect(
      resolveNotificationTarget(
        notif({ type: "monthly_report_ready", data: { month: "2026-09" } }),
      ),
    ).toEqual({ kind: "download", month: "2026-09" });
  });

  it("has nowhere to send a queued monthly report", () => {
    expect(resolveNotificationTarget(notif({ type: "monthly_report_queued" }))).toBeNull();
  });

  it("leaves a group invitation to its own accept/reject buttons", () => {
    expect(
      resolveNotificationTarget(notif({ type: "group_invitation", data: { member_id: 3 } })),
    ).toBeNull();
  });

  it("sends a release announcement to its version page", () => {
    expect(
      resolveNotificationTarget(notif({ type: "whats_new", data: { version: "v1.6" } })),
    ).toEqual({ kind: "navigate", path: "/changes/v1.6" });
  });

  it("has nowhere to send a release announcement without a version", () => {
    expect(resolveNotificationTarget(notif({ type: "whats_new", data: {} }))).toBeNull();
  });
});

describe("getNotifActionLabel", () => {
  it("labels only the notifications that have somewhere to go", () => {
    expect(getNotifActionLabel(notif({ type: "budget_warning" }))).toBe("Ver presupuestos →");
    expect(getNotifActionLabel(notif({ type: "whats_new", data: { version: "v1.6" } }))).toBe(
      "Ver novedades →",
    );
    expect(getNotifActionLabel(notif({ type: "group_invitation" }))).toBeNull();
    expect(getNotifActionLabel(notif({ type: "monthly_report_queued" }))).toBeNull();
    expect(getNotifActionLabel(notif({ type: "import_ready", data: {} }))).toBeNull();
  });

  it("never labels a notification that has no destination", () => {
    const types = [
      "import_ready",
      "import_failed",
      "uncategorized_expense",
      "uncategorized_expenses",
      "category_suggestions",
      "auto_recurring_detected",
      "budget_warning",
      "monthly_report_ready",
      "monthly_report_queued",
      "group_invitation",
      "something_new",
    ];
    for (const type of types) {
      const n = notif({ type, data: {} });
      const hasTarget = resolveNotificationTarget(n) !== null;
      expect(getNotifActionLabel(n) !== null).toBe(hasTarget);
    }
  });
});

describe("getNotifIcon", () => {
  it("colors an exceeded budget as an error and a warning budget as a warning", () => {
    expect(
      getNotifIcon(notif({ type: "budget_warning", data: { status: "exceeded" } })).color,
    ).toBe("text-red-500");
    expect(getNotifIcon(notif({ type: "budget_warning", data: { status: "warning" } })).color).toBe(
      "text-amber-500",
    );
  });
});
