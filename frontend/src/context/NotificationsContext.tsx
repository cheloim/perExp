import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import type { Notification } from "../types";
import {
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification as apiDeleteNotification,
  deleteAllReadNotifications,
} from "../api/client";
import { showToast } from "../utils/toast";

interface NotificationsState {
  notifications: Notification[];
  unreadCount: number;
  pendingCount: number;
  connected: boolean;
}

interface NotificationsContextValue extends NotificationsState {
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  deleteNotification: (id: number) => Promise<void>;
  deleteAllRead: () => Promise<void>;
  refresh: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

const BROADCAST_CHANNEL_NAME = "notif-sync";
const WORKER_URL = import.meta.env.DEV
  ? "/src/workers/notifications.worker.ts"
  : "/assets/notifications.worker.js";

interface WorkerMessage {
  type: "initial" | "notification" | "counts_update" | "token_expired" | "error" | "connected";
  notifications?: Notification[];
  notification?: Notification;
  unread_count?: number;
  pending_count?: number;
  message?: string;
}

interface WorkerOutgoingMessage {
  type: "new_token" | "force_refresh" | "disconnect";
  token?: string;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NotificationsState>({
    notifications: [],
    unreadCount: 0,
    pendingCount: 0,
    connected: false,
  });

  const [port, setPort] = useState<MessagePort | null>(null);
  const [broadcastChannel] = useState(() => new BroadcastChannel(BROADCAST_CHANNEL_NAME));

  const stateRef = useRef(state);
  stateRef.current = state;

  const handleNewNotification = useCallback((notification: Notification) => {
    // Show toast for import notifications
    if (notification.type === "import_ready") {
      showToast(notification.title, "success", 5000, "top-right");
    } else if (notification.type === "import_failed") {
      showToast(notification.title, "error", 5000, "top-right");
    } else if (notification.type === "uncategorized_expense") {
      showToast(notification.title, "info", 5000, "top-right");
    }

    setState((s) => {
      const exists = s.notifications.some((n) => n.id === notification.id);
      if (exists) {
        return {
          ...s,
          notifications: s.notifications.map((n) => (n.id === notification.id ? notification : n)),
        };
      }
      return {
        ...s,
        notifications: [notification, ...s.notifications],
      };
    });
  }, []);

  const handleCountsUpdate = useCallback((unread_count: number, pending_count: number) => {
    setState((s) => ({
      ...s,
      unreadCount: unread_count,
      pendingCount: pending_count,
    }));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) return;

    let workerPort: MessagePort | null = null;

    try {
      const worker = new SharedWorker(new URL(WORKER_URL, import.meta.url), {
        name: "notifications-worker",
      });
      workerPort = worker.port;
      workerPort.start();
      workerPort.postMessage({ type: "new_token", token } as WorkerOutgoingMessage);
    } catch {
      setState((s) => ({ ...s, connected: false }));
      return;
    }

    setPort(workerPort);

    const handleMessage = (e: MessageEvent) => {
      const msg = e.data as WorkerMessage;

      if (msg.type === "connected") {
        setState((s) => ({ ...s, connected: true }));
      } else if (msg.type === "initial") {
        setState((s) => ({
          ...s,
          notifications: msg.notifications ?? [],
          unreadCount: msg.unread_count ?? 0,
          pendingCount: msg.pending_count ?? 0,
          connected: true,
        }));
      } else if (msg.type === "notification" && msg.notification) {
        handleNewNotification(msg.notification);
        broadcastChannel.postMessage({
          type: "notification_update",
          notification: msg.notification,
        });
      } else if (msg.type === "counts_update") {
        handleCountsUpdate(
          msg.unread_count ?? stateRef.current.unreadCount,
          msg.pending_count ?? stateRef.current.pendingCount,
        );
        broadcastChannel.postMessage({
          type: "counts_update",
          unread_count: msg.unread_count,
          pending_count: msg.pending_count,
        });
      } else if (msg.type === "token_expired") {
        setState((s) => ({ ...s, connected: false }));
      }
    };

    workerPort.addEventListener("message", handleMessage);

    return () => {
      workerPort!.removeEventListener("message", handleMessage);
      workerPort!.postMessage({ type: "disconnect" } as WorkerOutgoingMessage);
      workerPort!.close();
      setPort(null);
    };
  }, [broadcastChannel, handleNewNotification, handleCountsUpdate]);

  useEffect(() => {
    const handleBroadcast = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === "notification_update" && msg.notification) {
        handleNewNotification(msg.notification);
      } else if (msg.type === "counts_update") {
        handleCountsUpdate(
          msg.unread_count ?? stateRef.current.unreadCount,
          msg.pending_count ?? stateRef.current.pendingCount,
        );
      }
    };

    broadcastChannel.addEventListener("message", handleBroadcast);
    return () => broadcastChannel.removeEventListener("message", handleBroadcast);
  }, [broadcastChannel, handleNewNotification, handleCountsUpdate]);

  const markRead = useCallback(async (id: number) => {
    try {
      const n = stateRef.current.notifications.find((n) => n.id === id);
      if (n?.read) return;

      await markNotificationRead(id);
      setState((s) => ({
        ...s,
        notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        unreadCount: Math.max(0, s.unreadCount - 1),
      }));
    } catch (err) {
      console.error("[NotificationsContext] markRead failed", err);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await markAllNotificationsRead();
      setState((s) => ({
        ...s,
        notifications: s.notifications.map((n) => ({ ...n, read: true })),
        unreadCount: 0,
      }));
    } catch (err) {
      console.error("[NotificationsContext] markAllRead failed", err);
    }
  }, []);

  const deleteNotification = useCallback(async (id: number) => {
    try {
      const n = stateRef.current.notifications.find((n) => n.id === id);
      await apiDeleteNotification(id);
      setState((s) => ({
        ...s,
        notifications: s.notifications.filter((n) => n.id !== id),
        unreadCount: n && !n.read ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
      }));
    } catch (err) {
      console.error("[NotificationsContext] deleteNotification failed", err);
    }
  }, []);

  const deleteAllRead = useCallback(async () => {
    try {
      await deleteAllReadNotifications();
      setState((s) => ({
        ...s,
        notifications: s.notifications.filter((n) => !n.read),
      }));
      // Force SSE stream to re-sync after deletion
      if (port) {
        port.postMessage({ type: "force_refresh" } as WorkerOutgoingMessage);
      }
    } catch (err) {
      console.error("[NotificationsContext] deleteAllRead failed", err);
    }
  }, [port]);

  const refresh = useCallback(() => {
    if (port) {
      port.postMessage({ type: "force_refresh" } as WorkerOutgoingMessage);
    }
  }, [port]);

  return (
    <NotificationsContext.Provider
      value={{ ...state, markRead, markAllRead, deleteNotification, deleteAllRead, refresh }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return context;
}
