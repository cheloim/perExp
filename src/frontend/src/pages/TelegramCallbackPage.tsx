import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getStoredToken, storeToken } from "../api/client";

/**
 * Handles the redirect from Telegram's OIDC authorization endpoint.
 * The backend exchanges the code and redirects here with ?token=...
 * or ?error=... if something failed.
 */
export default function TelegramCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");
    const errorParam = searchParams.get("error");
    const tgId = searchParams.get("tg_id");

    // Success — store token and redirect
    if (token) {
      storeToken(token);
      navigate("/", { replace: true });
      return;
    }

    if (errorParam) {
      // Telegram not linked — try to auto-link if user is already authenticated
      if (errorParam === "telegram_not_linked" && tgId) {
        const existingToken = getStoredToken();
        if (existingToken) {
          // User is authenticated (e.g., via Google) — they need to link via MiniApp
          setError(
            "Tu cuenta de Telegram no está vinculada. Abrí la MiniApp de Telegram desde el bot para vincular automáticamente, o vinculá desde Configuración → Telegram Bot.",
          );
          return;
        }
        // Not authenticated — need to log in first
        setError(
          "Tu cuenta de Telegram no está vinculada. Iniciá sesión con Google o email, y luego vinculá tu Telegram desde la MiniApp.",
        );
        return;
      }

      const errorMessages: Record<string, string> = {
        telegram_oidc_failed: "No se pudo conectar con Telegram. Intentá de nuevo.",
        telegram_token_invalid: "El token de Telegram es inválido o expiró.",
        telegram_no_id: "No se pudo obtener tu ID de Telegram.",
        telegram_not_linked:
          "Tu cuenta de Telegram no está vinculada. Vinculala desde Configuración → Telegram Bot.",
        telegram_account_issue: "Tu cuenta está desactivada o bloqueada.",
      };
      setError(errorMessages[errorParam] || "Error desconocido al iniciar sesión con Telegram.");
      return;
    }

    // No token and no error — might be a direct access
    setError("No se recibió respuesta de Telegram.");
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-base)]">
        <div className="card p-8 max-w-md w-full mx-4 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            Error de autenticación
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6">{error}</p>
          <div className="flex flex-col gap-3 items-center">
            <button
              onClick={() => navigate("/login", { replace: true })}
              className="gnome-btn-primary-round px-6 py-2"
            >
              Volver al login
            </button>
            <button
              onClick={() => navigate("/", { replace: true })}
              className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              Ir al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-base)]">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-sm text-[var(--text-secondary)]">Conectando con Telegram...</p>
      </div>
    </div>
  );
}
