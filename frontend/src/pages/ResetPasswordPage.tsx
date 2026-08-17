import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api/client";
import { APP_NAME } from "../config";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-8 gap-3">
            <div className="w-12 h-12 rounded-lg bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-xl shadow-gnome">
              F
            </div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              {APP_NAME}
            </h1>
          </div>
          <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome p-6 text-center">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
              Enlace inválido
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              El enlace para restablecer la contraseña no es válido o ya fue utilizado.
            </p>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="gnome-btn-primary w-full"
            >
              Ir al inicio de sesión
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Las contraseñas no coinciden");
      return;
    }
    if (password.length < 8) {
      setError("Mínimo 8 caracteres");
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError("Debe contener al menos una mayúscula");
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError("Debe contener al menos una minúscula");
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError("Debe contener al menos un número");
      return;
    }
    if (!/[!@#$%^&*()\-_+=<>?/[\]{}|]/.test(password)) {
      setError("Debe contener al menos un carácter especial (!@#$%^&*...)");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, password);
      setSuccess(true);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Error al restablecer la contraseña");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-12 h-12 rounded-lg bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-xl shadow-gnome">
            F
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
            Financial <span className="text-[var(--color-primary)]">Planning</span>
          </h1>
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome p-6 flex flex-col gap-4">
          {success ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-[var(--green-5,#26a269)]/10 flex items-center justify-center mx-auto mb-3">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-[var(--green-5,#26a269)]"
                >
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                Contraseña actualizada
              </h2>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Tu contraseña fue restablecida correctamente. Ya podés iniciar sesión con tu nueva
                contraseña.
              </p>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="gnome-btn-primary w-full"
              >
                Iniciar sesión
              </button>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  Nueva contraseña
                </h2>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                  Elegí una nueva contraseña para tu cuenta.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label
                    className="text-sm font-medium text-[var(--text-primary)]"
                    htmlFor="new-password"
                  >
                    Nueva contraseña
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    name="new-password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    required
                    className="input"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    className="text-sm font-medium text-[var(--text-primary)]"
                    htmlFor="confirm-password"
                  >
                    Confirmar contraseña
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    name="new-password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="input"
                  />
                </div>

                {error && <div className="alert-error">{error}</div>}

                <button type="submit" disabled={loading} className="gnome-btn-primary w-full mt-1">
                  {loading ? "Guardando..." : "Restablecer contraseña"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
