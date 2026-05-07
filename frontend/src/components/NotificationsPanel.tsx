import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getNotifications, rejectGroupInvitation } from '../api/client'
import type { Notification } from '../types'
import InvitationDisclaimer from './InvitationDisclaimer'

interface Props {
  onClose: () => void
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Ahora'
  if (mins < 60) return `Hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Hace ${hours}h`
  return `Hace ${Math.floor(hours / 24)}d`
}

export default function NotificationsPanel({ onClose }: Props) {
  const queryClient = useQueryClient()
  const [disclaimer, setDisclaimer] = useState<{ notifId: number; inviterName: string } | null>(null)

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
  })

  const reject = useMutation({
    mutationFn: rejectGroupInvitation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-count'] })
    },
  })

  const handleAccept = (n: Notification) => {
    const inviterName = (n.data.inviter_name as string) || 'el invitante'
    setDisclaimer({ notifId: n.id, inviterName })
  }

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />

      <div className="fixed bottom-20 left-4 z-40 w-80 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col max-h-[480px]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2 text-white font-semibold">
            🔔 Notificaciones
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors text-lg leading-none">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {isLoading && (
            <p className="text-gray-500 text-sm text-center py-8">Cargando…</p>
          )}
          {!isLoading && notifications.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-8">Sin notificaciones</p>
          )}
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`px-4 py-3 border-b border-gray-800 last:border-0 ${!n.read ? 'bg-indigo-950/30' : ''}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-white text-sm font-medium leading-tight">{n.title}</p>
                <span className="text-gray-500 text-xs whitespace-nowrap">{timeAgo(n.created_at)}</span>
              </div>
              <p className="text-gray-400 text-xs mb-2">{n.body}</p>

              {n.type === 'group_invitation' && !n.read && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAccept(n)}
                    className="text-xs px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                  >
                    ✓ Aceptar
                  </button>
                  <button
                    onClick={() => reject.mutate(n.id)}
                    disabled={reject.isPending}
                    className="text-xs px-3 py-1 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    ✕ Rechazar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {disclaimer && (
        <InvitationDisclaimer
          notificationId={disclaimer.notifId}
          inviterName={disclaimer.inviterName}
          onClose={() => setDisclaimer(null)}
        />
      )}
    </>
  )
}
