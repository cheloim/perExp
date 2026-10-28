import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotificationsPanel from "./NotificationsPanel";
import type { Notification } from "../types";

/**
 * The panel's contracts with #412: the notification text is shown in full (no
 * clamp, no ellipsis) and a notification is deleted with a single click.
 */
const h = vi.hoisted(() => ({
  notifications: [] as Notification[],
  deleteNotification: vi.fn(async () => {}),
  deleteAllRead: vi.fn(async () => {}),
  markRead: vi.fn(async () => {}),
  markAllRead: vi.fn(async () => {}),
  refresh: vi.fn(),
}));

vi.mock("../context/NotificationsContext", () => ({
  useNotifications: () => ({
    notifications: h.notifications,
    unreadCount: 0,
    pendingCount: 0,
    connected: true,
    markRead: h.markRead,
    markAllRead: h.markAllRead,
    deleteNotification: h.deleteNotification,
    deleteAllRead: h.deleteAllRead,
    refresh: h.refresh,
  }),
}));

vi.mock("../context/UploadProgressContext", () => ({
  useUploadProgress: () => ({ uploads: [], removeUpload: vi.fn(), cancelUpload: vi.fn() }),
}));

vi.mock("../api/client", () => ({
  rejectGroupInvitation: vi.fn(),
  downloadReportPdf: vi.fn(),
  deleteImportJob: vi.fn(async () => {}),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

function renderPanel(n: Notification) {
  h.notifications = [n];
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationsPanel onClose={() => {}} />
    </QueryClientProvider>,
  );
}

const LONG_BODY =
  "El gasto de $55.479,67 de YENNY TORTUGAS OPEN MALL del 13/10 quedó en " +
  "Electricidad & Gas, pero es una librería.\n" +
  "Tu consumo real de servicios fue únicamente Edenor ($42.119,33).\n" +
  "Revisá la categoría antes de cerrar el mes.";

const NOTIFICATION: Notification = {
  id: 7,
  type: "budget_warning",
  title: "Sugerencia de categorización para 1 gasto con un título largo que antes se cortaba",
  body: LONG_BODY,
  read: false,
  created_at: new Date().toISOString(),
  data: { status: "warning" },
};

describe("NotificationsPanel", () => {
  beforeEach(() => {
    h.notifications = [];
    vi.clearAllMocks();
  });

  it("shows the whole body and title, without clamping or truncating", () => {
    const { container } = renderPanel(NOTIFICATION);

    // The body was `line-clamp-2` and the title `truncate`; both hid text.
    expect(container.querySelector(".line-clamp-2")).toBeNull();
    expect(container.querySelector(".truncate")).toBeNull();
    expect(container.textContent).toContain(LONG_BODY);
    expect(container.textContent).toContain(NOTIFICATION.title);
  });

  it("deletes a notification with a single click", () => {
    renderPanel(NOTIFICATION);

    fireEvent.click(screen.getByTitle("Eliminar notificación"));

    expect(h.deleteNotification).toHaveBeenCalledTimes(1);
    expect(h.deleteNotification).toHaveBeenCalledWith(7);
  });

  it("keeps the confirm step only where the click destroys more than the notification", () => {
    // An import notification carries a job behind it, so deleting it takes the
    // confirmation dialog — the one-click contract is for notifications alone.
    renderPanel({
      id: 8,
      type: "import_ready",
      title: "Importación lista",
      body: "Se procesaron 12 filas",
      read: false,
      created_at: new Date().toISOString(),
      data: { job_id: 42 },
    });

    fireEvent.click(screen.getByTitle("Eliminar notificación"));

    expect(h.deleteNotification).not.toHaveBeenCalled();
    expect(screen.getByText("Eliminar importación")).toBeInTheDocument();
  });
});
