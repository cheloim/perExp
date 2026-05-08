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

      <div className="fixed bottom-20 left-4 z-40 w-80 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome-lg flex flex-col max-h-[480px]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)] font-semibold">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="text-[var(--color-primary)]">
              <path d="M8 16a2 2 0 01-2-2h4a2 2 0 01-2 2v-3H8v3zM15 6a4 4 0 00-8 0v3h8V6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
            Notificaciones
          </div>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-lg leading-none">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {isLoading && (
            <p className="text-[var(--text-tertiary)] text-sm text-center py-8">Cargando…</p>
          )}
          {!isLoading && notifications.length === 0 && (
            <p className="text-[var(--text-tertiary)] text-sm text-center py-8">Sin notificaciones</p>
          )}
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`px-4 py-3 border-b border-[var(--border-color)] last:border-0 ${!n.read ? 'bg-[var(--color-primary)]/8' : ''}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-[var(--text-primary)] text-sm font-medium leading-tight">{n.title}</p>
                <span className="text-[var(--text-tertiary)] text-xs whitespace-nowrap">{timeAgo(n.created_at)}</span>
              </div>
              <p className="text-[var(--text-secondary)] text-xs mb-2">{n.body}</p>

              {n.type === 'group_invitation' && !n.read && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAccept(n)}
                    className="text-xs px-3 py-1 rounded-md bg-[var(--color-primary)] hover:brightness-110 text-white transition-colors"
                  >
                    ✓ Aceptar
                  </button>
                  <button
                    onClick={() => reject.mutate(n.id)}
                    disabled={reject.isPending}
                    className="text-xs px-3 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition-colors disabled:opacity-50"
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