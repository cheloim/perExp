import { useMutation, useQueryClient } from "@tanstack/react-query";
import { acceptGroupInvitation } from "../api/client";

interface Props {
  notificationId: number;
  inviterName: string;
  onClose: () => void;
}

export default function InvitationDisclaimer({ notificationId, inviterName, onClose }: Props) {
  const queryClient = useQueryClient();
  const { mutate, isPending, isError } = useMutation({
    mutationFn: () => acceptGroupInvitation(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
      queryClient.invalidateQueries({ queryKey: ["my-group"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["card-summary"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["scheduled-summary"] });
      queryClient.invalidateQueries({ queryKey: ["top-merchants"] });
      queryClient.invalidateQueries({ queryKey: ["distinct-values"] });
      queryClient.invalidateQueries({ queryKey: ["credit-card-pasivos"] });
      queryClient.invalidateQueries({ queryKey: ["installments-monthly-load"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-container/60">
      <div className="bg-surface border border-border-color rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">⚠️</span>
          <h2 className="text-primary font-semibold text-lg">Compartir datos de cuenta</h2>
        </div>

        <p className="text-secondary text-sm mb-3">
          Al aceptar, <span className="text-primary font-medium">tú y {inviterName}</span> podrán
          ver los gastos e información financiera de ambos. Esta es una relación bidireccional.
        </p>
        <p className="text-tertiary text-sm mb-6">
          Podés salir del grupo en cualquier momento desde{" "}
          <span className="text-secondary">Mi cuenta → Grupo Familiar</span>.
        </p>

        {isError && <p className="text-danger text-sm mb-4">Ocurrió un error. Intentá de nuevo.</p>}

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
            className="flex-1 py-2 rounded-lg gnome-btn-primary text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isPending ? "Confirmando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
