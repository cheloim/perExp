import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { NotificationsProvider, useNotifications } from "./NotificationsContext";
import type { Notification } from "../types";

/**
 * #455: deleting a notification made it disappear and then come back, because
 * the panel refreshed the SSE stream before the DELETE had committed. These
 * cover the two halves of the fix: the row leaves immediately, and a delete
 * that really failed puts it back and says so.
 */
const h = vi.hoisted(() => ({
  port: null as null | {
    emit: (data: unknown) => void;
  },
  deleteNotification: vi.fn<(id: number) => Promise<void>>(),
  deleteAllNotifications: vi.fn<() => Promise<void>>(),
  showToast: vi.fn(),
}));

vi.mock("../api/client", () => ({
  markNotificationRead: vi.fn(async () => {}),
  markAllNotificationsRead: vi.fn(async () => {}),
  deleteNotification: (id: number) => h.deleteNotification(id),
  deleteAllReadNotifications: vi.fn(async () => {}),
  deleteAllNotifications: () => h.deleteAllNotifications(),
  downloadReportPdf: vi.fn(),
}));

vi.mock("../utils/toast", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
  pushToast: vi.fn(),
  dismissToast: vi.fn(),
  pauseToast: vi.fn(),
  resumeToast: vi.fn(),
  subscribeToasts: () => () => {},
  getToasts: () => [],
}));

const NOTIFICATION: Notification = {
  id: 7,
  type: "budget_warning",
  title: "Te pasaste del presupuesto",
  body: "Gastaste $55.479,67 este mes.",
  read: false,
  created_at: new Date().toISOString(),
  data: { status: "exceeded" },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <NotificationsProvider>{children}</NotificationsProvider>
  </MemoryRouter>
);

/** Seeds the provider through the same door the SSE stream uses. */
function seed(notifications: Notification[], unreadCount: number) {
  act(() => {
    h.port!.emit({
      type: "initial",
      notifications,
      unread_count: unreadCount,
      pending_count: 0,
    });
  });
}

describe("NotificationsContext.deleteNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    class FakePort {
      private listeners: Array<(e: { data: unknown }) => void> = [];
      start() {}
      postMessage() {}
      close() {}
      addEventListener(_type: string, fn: (e: { data: unknown }) => void) {
        this.listeners.push(fn);
      }
      removeEventListener() {}
      emit(data: unknown) {
        for (const fn of this.listeners) fn({ data });
      }
    }
    class FakeSharedWorker {
      port = new FakePort();
      constructor() {
        h.port = this.port;
      }
    }
    class FakeBroadcastChannel {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
    }
    vi.stubGlobal("SharedWorker", FakeSharedWorker);
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    // The provider only opens the stream once it has a session.
    localStorage.setItem("auth_token", "test-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("takes the notification out before the server answers", async () => {
    let settle!: () => void;
    h.deleteNotification.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );

    const { result } = renderHook(() => useNotifications(), { wrapper });
    seed([NOTIFICATION], 1);
    expect(result.current.notifications).toHaveLength(1);

    act(() => {
      void result.current.deleteNotification(7);
    });

    // Gone while the request is still in flight. Waiting for the response is
    // what let a stream re-read resurrect it.
    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.unreadCount).toBe(0);

    await act(async () => {
      settle();
    });
    await waitFor(() => expect(h.deleteNotification).toHaveBeenCalledWith(7));
    expect(result.current.notifications).toHaveLength(0);
  });

  it("puts the notification back and says so when the delete fails", async () => {
    h.deleteNotification.mockRejectedValue(new Error("500"));

    const { result } = renderHook(() => useNotifications(), { wrapper });
    seed([NOTIFICATION], 1);

    await act(async () => {
      await result.current.deleteNotification(7);
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.unreadCount).toBe(1);
    expect(h.showToast).toHaveBeenCalledWith(
      "No se pudo eliminar la notificación",
      "error",
      6000,
      "bottom-center",
    );
  });
});

describe("NotificationsContext.deleteAll", () => {
  const SECOND: Notification = {
    ...NOTIFICATION,
    id: 8,
    title: "Otra alerta",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    class FakePort {
      private listeners: Array<(e: { data: unknown }) => void> = [];
      start() {}
      postMessage() {}
      close() {}
      addEventListener(_type: string, fn: (e: { data: unknown }) => void) {
        this.listeners.push(fn);
      }
      removeEventListener() {}
      emit(data: unknown) {
        for (const fn of this.listeners) fn({ data });
      }
    }
    class FakeSharedWorker {
      port = new FakePort();
      constructor() {
        h.port = this.port;
      }
    }
    class FakeBroadcastChannel {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
    }
    vi.stubGlobal("SharedWorker", FakeSharedWorker);
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    localStorage.setItem("auth_token", "test-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("clears everything before the server answers", async () => {
    let settle!: () => void;
    h.deleteAllNotifications.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );

    const { result } = renderHook(() => useNotifications(), { wrapper });
    seed([NOTIFICATION, SECOND], 2);
    expect(result.current.notifications).toHaveLength(2);

    act(() => {
      void result.current.deleteAll();
    });

    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.unreadCount).toBe(0);

    await act(async () => {
      settle();
    });
    await waitFor(() => expect(h.deleteAllNotifications).toHaveBeenCalledTimes(1));
    expect(result.current.notifications).toHaveLength(0);
  });

  it("restores the list and says so when the delete fails", async () => {
    h.deleteAllNotifications.mockRejectedValue(new Error("500"));

    const { result } = renderHook(() => useNotifications(), { wrapper });
    seed([NOTIFICATION, SECOND], 2);

    await act(async () => {
      await result.current.deleteAll();
    });

    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unreadCount).toBe(2);
    expect(h.showToast).toHaveBeenCalledWith(
      "No se pudieron eliminar las notificaciones",
      "error",
      6000,
      "bottom-center",
    );
  });
});
