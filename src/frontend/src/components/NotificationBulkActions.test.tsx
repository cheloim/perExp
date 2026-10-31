import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import NotificationBulkActions from "./NotificationBulkActions";
import type { Notification } from "../types";

const h = vi.hoisted(() => ({
  notifications: [] as Notification[],
  markAllRead: vi.fn(async () => {}),
  deleteAllRead: vi.fn(async () => {}),
  deleteAll: vi.fn(async () => {}),
}));

vi.mock("../context/NotificationsContext", () => ({
  useNotifications: () => ({
    notifications: h.notifications,
    markAllRead: h.markAllRead,
    deleteAllRead: h.deleteAllRead,
    deleteAll: h.deleteAll,
  }),
}));

const NOTIFICATION: Notification = {
  id: 1,
  type: "budget_warning",
  title: "Alerta",
  body: "Body",
  read: false,
  created_at: new Date().toISOString(),
  data: { status: "warning" },
};

describe("NotificationBulkActions", () => {
  beforeEach(() => {
    h.notifications = [];
    vi.clearAllMocks();
  });

  it("asks for confirmation before deleting every notification", () => {
    h.notifications = [NOTIFICATION];
    render(<NotificationBulkActions />);

    fireEvent.click(screen.getByRole("button", { name: "Eliminar todas" }));

    expect(h.deleteAll).not.toHaveBeenCalled();
    expect(screen.getByText("Eliminar todas las notificaciones")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(h.deleteAll).toHaveBeenCalledTimes(1);
  });

  it("hides the action when there is nothing to delete", () => {
    render(<NotificationBulkActions />);

    expect(screen.queryByRole("button", { name: "Eliminar todas" })).not.toBeInTheDocument();
  });
});
