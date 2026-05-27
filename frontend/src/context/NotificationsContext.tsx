import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import type { Notification } from '../types'

interface NotificationsState {
  notifications: Notification[]
  unreadCount: number
  pendingCount: number
  connected: boolean
}

interface NotificationsContextValue extends NotificationsState {
  markRead: (id: number) => Promise<void>
  refresh: () => void
}

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined)

const BROADCAST_CHANNEL_NAME = 'notif-sync'
const WORKER_URL = '/src/workers/notifications.worker.ts'

interface WorkerMessage {
  type: 'initial' | 'notification' | 'counts_update' | 'token_expired' | 'error' | 'connected'
  notifications?: Notification[]
  notification?: Notification
  unread_count?: number
  pending_count?: number
  message?: string
}

interface WorkerOutgoingMessage {
  type: 'new_token' | 'force_refresh' | 'disconnect'
  token?: string
}

function getStoredToken(): string | null {
  return localStorage.getItem('auth_token')
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NotificationsState>({
    notifications: [],
    unreadCount: 0,
    pendingCount: 0,
    connected: false,
  })

  const [port, setPort] = useState<MessagePort | null>(null)
  const [broadcastChannel] = useState(() => new BroadcastChannel(BROADCAST_CHANNEL_NAME))

  const handleNewNotification = useCallback((notification: Notification) => {
    setState((s) => {
      const exists = s.notifications.some((n) => n.id === notification.id)
      if (exists) {
        return {
          ...s,
          notifications: s.notifications.map((n) =>
            n.id === notification.id ? notification : n,
          ),
        }
      }
      return {
        ...s,
        notifications: [notification, ...s.notifications],
      }
    })
  }, [])

  const handleCountsUpdate = useCallback((unread_count: number, pending_count: number) => {
    setState((s) => ({
      ...s,
      unreadCount: unread_count,
      pendingCount: pending_count,
    }))
  }, [])

  useEffect(() => {
    const token = getStoredToken()
    if (!token) return

    let workerPort: MessagePort | null = null

    try {
      const worker = new SharedWorker(new URL(WORKER_URL, import.meta.url), {
        name: 'notifications-worker',
      })
      workerPort = worker.port
      workerPort.start()
      workerPort.postMessage({ type: 'new_token', token } as WorkerOutgoingMessage)
    } catch {
      setState((s) => ({ ...s, connected: false }))
      return
    }

    setPort(workerPort)

    const handleMessage = (e: MessageEvent) => {
      const msg = e.data as WorkerMessage

      if (msg.type === 'connected') {
        setState((s) => ({ ...s, connected: true }))
      } else if (msg.type === 'initial') {
        setState((s) => ({
          ...s,
          notifications: msg.notifications ?? [],
          unreadCount: msg.unread_count ?? 0,
          pendingCount: msg.pending_count ?? 0,
          connected: true,
        }))
      } else if (msg.type === 'notification' && msg.notification) {
        handleNewNotification(msg.notification)
        broadcastChannel.postMessage({ type: 'notification_update', notification: msg.notification })
      } else if (msg.type === 'counts_update') {
        handleCountsUpdate(msg.unread_count ?? state.unreadCount, msg.pending_count ?? state.pendingCount)
        broadcastChannel.postMessage({
          type: 'counts_update',
          unread_count: msg.unread_count,
          pending_count: msg.pending_count,
        })
      } else if (msg.type === 'token_expired') {
        setState((s) => ({ ...s, connected: false }))
      }
    }

    workerPort.addEventListener('message', handleMessage)
    workerPort.start()

    return () => {
      workerPort!.removeEventListener('message', handleMessage)
      workerPort!.postMessage({ type: 'disconnect' } as WorkerOutgoingMessage)
      workerPort!.close()
      setPort(null)
    }
  }, [broadcastChannel, handleNewNotification, handleCountsUpdate, state.unreadCount, state.pendingCount])

  useEffect(() => {
    const handleBroadcast = (e: MessageEvent) => {
      const msg = e.data

      if (msg.type === 'notification_update' && msg.notification) {
        handleNewNotification(msg.notification)
      } else if (msg.type === 'counts_update') {
        handleCountsUpdate(
          msg.unread_count ?? state.unreadCount,
          msg.pending_count ?? state.pendingCount,
        )
      }
    }

    broadcastChannel.addEventListener('message', handleBroadcast)
    return () => broadcastChannel.removeEventListener('message', handleBroadcast)
  }, [broadcastChannel, handleNewNotification, handleCountsUpdate, state.unreadCount, state.pendingCount])

  const markRead = useCallback(
    async (id: number) => {
      try {
        await fetch(`/api/notifications/${id}/read`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${getStoredToken()}`,
          },
        })
        setState((s) => ({
          ...s,
          notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
          unreadCount: Math.max(0, s.unreadCount - 1),
        }))
      } catch (err) {
        console.error('[NotificationsContext] markRead failed', err)
      }
    },
    [],
  )

  const refresh = useCallback(() => {
    if (port) {
      port.postMessage({ type: 'force_refresh' } as WorkerOutgoingMessage)
    }
  }, [port])

  return (
    <NotificationsContext.Provider value={{ ...state, markRead, refresh }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationsContext)
  if (!context) {
    throw new Error('useNotifications must be used within NotificationsProvider')
  }
  return context
}
