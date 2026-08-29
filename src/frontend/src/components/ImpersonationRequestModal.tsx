import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

interface ImpersonationRequestModalProps {
  notificationId: number;
  adminName: string;
  sessionId: number;
  onAccept: () => void;
  onReject: () => void;
}

export default function ImpersonationRequestModal({
  notificationId,
  adminName,
  onAccept,
  onReject,
}: ImpersonationRequestModalProps) {
  const queryClient = useQueryClient();

  const acceptMut = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await axios.post(
        `/api/notifications/${notificationId}/accept`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      return res.data;
    },
    onSuccess: (data: any) => {
      if (data.token) {
        sessionStorage.setItem("impersonation_token", data.token);
        sessionStorage.setItem("impersonation_session_id", String(data.session_id));
      }
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      onAccept();
    },
  });

  const rejectMut = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      await axios.post(
        `/api/notifications/${notificationId}/reject`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      onReject();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center">
      <div className="card p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold text-primary mb-2">
          Solicitud de acceso administrativo
        </h2>
        <p className="text-sm text-secondary mb-4">
          <strong>{adminName}</strong> solicita acceso a tu cuenta para soporte técnico.
        </p>
        <p className="text-xs text-tertiary mb-4">
          Si aceptás, el administrador podrá ver y modificar datos en tu cuenta durante 30 minutos.
          Se registrará todas las acciones y recibirás un resumen por email al finalizar.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => rejectMut.mutate()}
            disabled={rejectMut.isPending}
            className="gnome-btn-secondary-round text-sm"
          >
            Rechazar
          </button>
          <button
            onClick={() => acceptMut.mutate()}
            disabled={acceptMut.isPending}
            className="gnome-btn-primary-round text-sm"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
