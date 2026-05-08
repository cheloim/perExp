import { useMutation, useQueryClient } from '@tanstack/react-query'
import { acceptGroupInvitation } from '../api/client'

interface Props {
  notificationId: number
  inviterName: string
  onClose: () => void
}

export default function InvitationDisclaimer({ notificationId, inviterName, onClose }: Props) {
  const queryClient = useQueryClient()
  const { mutate, isPending, isError } = useMutation({
    mutationFn: () => acceptGroupInvitation(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-count'] })
      queryClient.invalidateQueries({ queryKey: ['my-group'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-container/60">
      <div className="bg-surface border border-border-color rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">⚠️</span>
          <h2 className="text-primary font-semibold text-lg">Compartir datos de cuenta</h2>
        </div>

        <p className="text-secondary text-sm mb-3">
          Al aceptar esta invitación, <span className="text-primary font-medium">{inviterName}</span> podrá
          ver todos tus gastos e información financiera de tu cuenta.
        </p>
        <p className="text-tertiary text-sm mb-6">
          Esta acción se puede deshacer saliendo del grupo en cualquier momento desde{' '}
          <span className="text-secondary">Mi cuenta → Grupo Familiar</span>.
        </p>

        {isError && (
          <p className="text-danger text-sm mb-4">Ocurrió un error. Intentá de nuevo.</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-border-color text-secondary text-sm hover:bg-base-alt transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => mutate()}
            disabled={isPending}
            className="flex-1 py-2 rounded-lg btn-primary text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isPending ? 'Confirmando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
