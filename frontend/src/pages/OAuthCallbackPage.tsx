import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { oauthCallback, storeToken } from "../api/client";
import { APP_NAME } from "../config";

export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const code = searchParams.get("code");
    const authError = searchParams.get("error");

    if (authError) {
      setError("La autenticación con Google fue cancelada.");
      setLoading(false);
      return;
    }

    if (!code) {
      setError("Código de autorización no encontrado.");
      setLoading(false);
      return;
    }

    const handleCallback = async () => {
      try {
        const token = await oauthCallback("google", code);
        if (token.force_password_change) {
          storeToken(token.access_token);
          navigate("/login?force_change=1", { replace: true });
          return;
        }
        if (token.mfa_required) {
          navigate("/login?mfa=1", { replace: true, state: { token: token.access_token } });
          return;
        }
        storeToken(token.access_token);
        navigate("/", { replace: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error al autenticar con Google";
        setError(msg);
        setLoading(false);
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="flex flex-col items-center mb-8 gap-3">
            <div className="w-12 h-12 rounded-lg bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-xl shadow-gnome">
              F
            </div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              {APP_NAME}
            </h1>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">Autenticando con Google...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-12 h-12 rounded-lg bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-xl shadow-gnome">
            F
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
            {APP_NAME}
          </h1>
        </div>
        <div className="card p-6">
          <p className="text-sm text-red-500 mb-4">{error}</p>
          <button
            onClick={() => navigate("/login")}
            className="w-full py-2 px-4 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition"
          >
            Volver al login
          </button>
        </div>
      </div>
    </div>
  );
}
