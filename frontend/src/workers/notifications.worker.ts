/// <reference lib="webworker" />

interface NotifWorkerMessage {
  type: "new_token" | "force_refresh" | "disconnect";
  token?: string;
  portId?: string;
}

interface NotifWorkerResponse {
  type:
    | "initial"
    | "notification"
    | "counts_update"
    | "token_expired"
    | "error"
    | "connected"
    | "ping";
  notifications?: NotificationPayload[];
  notification?: NotificationPayload;
  unread_count?: number;
  pending_count?: number;
  message?: string;
}

interface NotificationPayload {
  id: number;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

const ports = new Map<string, MessagePort>();
let eventSource: EventSource | null = null;
let currentToken: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;

function broadcastToPorts(data: NotifWorkerResponse, excludePortId?: string) {
  for (const [portId, port] of ports) {
    if (portId !== excludePortId) {
      try {
        port.postMessage(data);
      } catch {
        ports.delete(portId);
      }
    }
  }
}

function closeEventSource() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function connectEventSource(token: string) {
  closeEventSource();
  currentToken = token;
  reconnectAttempt = 0;

  const url = `/api/notifications/stream?token=${encodeURIComponent(token)}`;
  eventSource = new EventSource(url);

  eventSource.onopen = () => {
    reconnectAttempt = 0;
    const connectedMsg: NotifWorkerResponse = { type: "connected" };
    for (const port of ports.values()) {
      try {
        port.postMessage(connectedMsg);
      } catch {
        // port closed
      }
    }
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as NotifWorkerResponse;

      if (data.type === "ping") {
        return;
      }
      broadcastToPorts(data);
    } catch (e) {
      console.error("[notifications.worker] Failed to parse SSE message", e);
    }
  };

  eventSource.onerror = () => {
    closeEventSource();

    broadcastToPorts({
      type: "token_expired",
      message: "SSE connection lost",
    });

    if (currentToken && ports.size > 0) {
      const delay = Math.min(
        INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempt),
        MAX_RECONNECT_DELAY,
      );
      reconnectAttempt++;
      reconnectTimer = setTimeout(() => {
        if (currentToken && ports.size > 0) {
          connectEventSource(currentToken);
        }
      }, delay);
    }
  };
}

self.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  const portId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  ports.set(portId, port);

  port.onmessage = (e: MessageEvent) => {
    const msg = e.data as NotifWorkerMessage;

    if (msg.type === "new_token" && msg.token) {
      connectEventSource(msg.token);
    } else if (msg.type === "force_refresh") {
      if (currentToken) {
        closeEventSource();
        reconnectAttempt = 0;
        connectEventSource(currentToken);
      }
    } else if (msg.type === "disconnect") {
      ports.delete(portId);
      if (ports.size === 0) {
        closeEventSource();
      }
    }
  };

  port.start();

  if (currentToken) {
    const initialMsg: NotifWorkerResponse = { type: "connected" };
    port.postMessage(initialMsg);
  }
};
