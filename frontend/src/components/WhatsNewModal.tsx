import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { markWhatsNewSeen } from "../api/client";
import SymbolicIcon from "./SymbolicIcon";

// Set this to false to hide the "What's New" modal for all users
// Re-enable by setting to true when you want to show it
const SHOW_WHATS_NEW = true;

interface WhatsNewModalProps {
  onClose: () => void;
}

function WhatsNewModal({ onClose }: WhatsNewModalProps) {
  const qc = useQueryClient();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const markSeenMutation = useMutation({
    mutationFn: markWhatsNewSeen,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user"] });
      onClose();
    },
  });

  const handleClose = () => {
    if (dontShowAgain) {
      markSeenMutation.mutate();
    } else {
      onClose();
    }
  };

  const features = [
    {
      icon: "chart-bar" as const,
      title: "Presupuestos por categoría",
      description:
        "Distribuí tu ingreso en Necesidades y Gustos, asigná límites por categoría y recibí alertas cuando te acercás al límite.",
      color: "#3584e4",
    },
    {
      icon: "chart-bar" as const,
      title: "Eventos temporales",
      description:
        "Creá presupuestos para vacaciones, viajes o cualquier evento especial. Vinculá gastos directamente al evento desde Telegram.",
      color: "#2ec27e",
    },
    {
      icon: "bot" as const,
      title: "Mejoras en el bot de Telegram",
      description:
        "El bot ahora detecta automáticamente si un gasto pertenece a un evento temporal y te pregunta antes de guardarlo.",
      color: "#3584e4",
    },
  ];

  if (!SHOW_WHATS_NEW) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-lg p-0 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[var(--color-primary)] to-[#62a0ea] p-6 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <SymbolicIcon name="sparkles" size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold">¡Novedades!</h2>
              <p className="text-sm text-white/80">Lo que agregamos recientemente</p>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="p-6 space-y-4">
          {features.map((feature, i) => (
            <div key={i} className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: feature.color + "15" }}
              >
                <SymbolicIcon name={feature.icon} size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{feature.title}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">{feature.description}</p>
              </div>
            </div>
          ))}

          <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
            <a
              href="/guide"
              className="text-sm text-[var(--color-primary)] hover:underline font-medium"
            >
              Ver guía completa →
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-4 h-4 rounded accent-[var(--color-primary)]"
            />
            <span className="text-xs text-[var(--text-secondary)]">No mostrar de nuevo</span>
          </label>
          <button
            onClick={handleClose}
            className="w-full px-4 py-2.5 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

export default WhatsNewModal;
export { SHOW_WHATS_NEW };
