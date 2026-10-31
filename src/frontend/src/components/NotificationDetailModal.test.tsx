import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NotificationDetailModal from "./NotificationDetailModal";
import type { Notification } from "../types";

const NOTIFICATION: Notification = {
  id: 7,
  type: "budget_warning",
  title: "Te pasaste del presupuesto",
  body: "Gastaste $55.479,67 este mes.\nRevisá el detalle antes de cerrar.",
  read: false,
  created_at: new Date().toISOString(),
  data: { status: "exceeded" },
};

describe("NotificationDetailModal", () => {
  it("shows the whole title and body", () => {
    render(
      <NotificationDetailModal notification={NOTIFICATION} onClose={vi.fn()} onAction={vi.fn()} />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(NOTIFICATION.title)).toBeInTheDocument();
    expect(screen.getByText(/Revisá el detalle/)).toBeInTheDocument();
  });

  it("runs the action and closes when the action button is pressed", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();

    render(
      <NotificationDetailModal notification={NOTIFICATION} onClose={onClose} onAction={onAction} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ver presupuestos →" }));

    expect(onAction).toHaveBeenCalledWith(NOTIFICATION);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes with the X button", () => {
    const onClose = vi.fn();

    render(
      <NotificationDetailModal notification={NOTIFICATION} onClose={onClose} onAction={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cerrar notificación" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape", () => {
    const onClose = vi.fn();

    render(
      <NotificationDetailModal notification={NOTIFICATION} onClose={onClose} onAction={vi.fn()} />,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
