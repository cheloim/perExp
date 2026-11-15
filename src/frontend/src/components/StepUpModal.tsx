import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { adminStepUp } from "../api/client";

interface StepUpModalProps {
  mfaEnabled?: boolean;
  onAuthenticated: () => void;
  onCancel: () => void;
}

/**
 * Fresh password/MFA proof before a destructive admin action. The resulting
 * token lives in client memory for 5 minutes and is sent as a header.
 */
export default function StepUpModal({ mfaEnabled, onAuthenticated, onCancel }: StepUpModalProps) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => adminStepUp(password, mfaEnabled ? code : undefined),
    onSuccess: () => onAuthenticated(),
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "No se pudo verificar tu identidad.");
    },
  });

  const canSubmit = password.length > 0 && (!mfaEnabled || code.length > 0);

  return (
    <div className="fixed inset-0 bg-black/60 z-[300] flex items-center justify-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-up-title"
        className="card p-6 max-w-sm w-full mx-4"
      >
        <h2 id="step-up-title" className="text-lg font-semibold text-primary mb-2">
          Confirmá tu identidad
        </h2>
        <p className="text-sm text-secondary mb-4">
          Esta acción es destructiva. Ingresá tu contraseña{mfaEnabled ? " y el código MFA" : ""}{" "}
          para continuar.
        </p>

        {error && <p className="text-sm text-[var(--color-danger)] mb-3">{error}</p>}

        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => e.key === "Enter" && canSubmit && mutation.mutate()}
          className="input w-full mb-3"
          autoFocus
        />
        {mfaEnabled && (
          <input
            type="text"
            inputMode="numeric"
            placeholder="Código MFA"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && mutation.mutate()}
            className="input w-full mb-3"
          />
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="gnome-btn-secondary-round text-sm">
            Cancelar
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
            className="gnome-btn-primary-round text-sm"
          >
            {mutation.isPending ? "Verificando..." : "Continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}
