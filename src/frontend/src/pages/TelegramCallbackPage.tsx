import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { exchangeTelegramOidcCode, getStoredToken, storeToken } from "../api/client";

const STATE_STORAGE_KEY = "telegram_oidc_state";

const ERROR_MESSAGES: Record<string, string> = {
  telegram_oidc_failed: "No se pudo conectar con Telegram. Intentá de nuevo.",
  telegram_token_invalid: "El token de Telegram es inválido o expiró.",
  telegram_no_id: "No se pudo obtener tu ID de Telegram.",
  telegram_not_linked:
    "Tu cuenta de Telegram no está vinculada. Vinculala desde Configuración → Telegram Bot.",
  telegram_account_issue: "Tu cuenta está desactivada o bloqueada.",
  telegram_state_invalid:
    "El enlace de autenticación no es válido o expiró. Iniciá sesión de nuevo.",
  telegram_state_unavailable:
    "No se pudo completar el inicio de sesión con Telegram. Intentá de nuevo.",
};

/**
 * Handles the redirect from Telegram's OIDC authorization endpoint.
 *
 * The backend redirects here with a short-lived, single-use `code` and the
 * original `state`. The access token is never part of the URL: it is obtained
 * by exchanging the code via POST.
 */
export default function TelegramCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // StrictMode runs effects twice in development. The code is single-use, so
  // the second run must not try to exchange it again.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const errorParam = searchParams.get("error");
    const tgId = searchParams.get("tg_id");
    const legacyToken = searchParams.get("token");

    // The code and state are single-use. Remove them from the URL immediately
    // so they do not remain in history or leak through the Referer header.
    if (code || state || legacyToken) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    // Tokens in the query string are no longer accepted. An old link (or an
    // attacker-crafted one) must not start a session.
    if (legacyToken) {
      setError("El enlace de autenticación no es válido. Iniciá sesión de nuevo.");
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

      setError(ERROR_MESSAGES[errorParam] || "Error desconocido al iniciar sesión con Telegram.");
      return;
    }

    if (!code || !state) {
      setError("No se recibió respuesta de Telegram.");
      return;
    }

    const expectedState = sessionStorage.getItem(STATE_STORAGE_KEY);
    sessionStorage.removeItem(STATE_STORAGE_KEY);
    if (!expectedState || expectedState !== state) {
      setError(ERROR_MESSAGES.telegram_state_invalid);
      return;
    }

    void (async () => {
      try {
        const token = await exchangeTelegramOidcCode(code);
        storeToken(token.access_token);
        navigate("/", { replace: true });
      } catch {
        setError("El código de autenticación ya se usó o expiró. Iniciá sesión de nuevo.");
      }
    })();
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
