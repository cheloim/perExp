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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">⚠️</span>
          <h2 className="text-white font-semibold text-lg">Compartir datos de cuenta</h2>
        </div>

        <p className="text-gray-300 text-sm mb-3">
          Al aceptar esta invitación, <span className="text-white font-medium">{inviterName}</span> podrá
          ver todos tus gastos e información financiera de tu cuenta.
        </p>
        <p className="text-gray-400 text-sm mb-6">
          Esta acción se puede deshacer saliendo del grupo en cualquier momento desde{' '}
          <span className="text-gray-300">Mi cuenta → Grupo Familiar</span>.
        </p>

        {isError && (
          <p className="text-red-400 text-sm mb-4">Ocurrió un error. Intentá de nuevo.</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-600 text-gray-300 text-sm hover:bg-gray-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => mutate()}
            disabled={isPending}
            className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isPending ? 'Confirmando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
