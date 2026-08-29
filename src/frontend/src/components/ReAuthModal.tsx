import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { login, storeToken } from "../api/client";

interface ReAuthModalProps {
  onAuthenticated: () => void;
  onCancel: () => void;
}

export default function ReAuthModal({ onAuthenticated, onCancel }: ReAuthModalProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const loginMut = useMutation({
    mutationFn: async () => {
      // Get email from stored token decode or use a fallback
      const token = localStorage.getItem("auth_token");
      if (!token) throw new Error("No token found");

      // Decode JWT to get user email (or use a stored email)
      const payload = JSON.parse(atob(token.split(".")[1]));
      const email = payload.email || "";
      if (!email) throw new Error("Cannot determine email");

      return login(email, password);
    },
    onSuccess: (data) => {
      storeToken(data.access_token);
      onAuthenticated();
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || "Error de autenticación");
    },
  });

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 bg-black/60 z-[300] flex items-center justify-center">
      <div className="card p-6 max-w-sm w-full mx-4">
        <h2 className="text-lg font-semibold text-primary mb-2">Re-autenticación requerida</h2>
        <p className="text-sm text-secondary mb-4">
          Tu sesión expiró. Ingresá tu contraseña para continuar en el panel de administración.
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
          onKeyDown={(e) => e.key === "Enter" && loginMut.mutate()}
          className="gnome-input w-full mb-4"
          autoFocus
        />

        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="gnome-btn-secondary-round text-sm">
            Cancelar
          </button>
          <button
            onClick={() => loginMut.mutate()}
            disabled={!password || loginMut.isPending}
            className="gnome-btn-primary-round text-sm"
          >
            {loginMut.isPending ? "Verificando..." : "Continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}
