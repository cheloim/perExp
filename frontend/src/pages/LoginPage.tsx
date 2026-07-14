import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  forgotPassword,
  forceChangePassword,
  login,
  loginMfa,
  oauthLogin,
  register,
  storeToken,
} from "../api/client";
import { APP_NAME } from "../config";

const SPECIAL_CHARS = /[!@#$%^&*()\-_+=<>?/[\]{}|]/;

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "force-change" | "mfa">(
    "login",
  );
  const [forceToken, setForceToken] = useState("");
  const [mfaToken, setMfaToken] = useState("");

  // Show auth error from 401 redirect
  const [authRedirectError, setAuthRedirectError] = useState("");
  useEffect(() => {
    const authError = sessionStorage.getItem("auth_error");
    if (authError) {
      setAuthRedirectError(authError);
      sessionStorage.removeItem("auth_error");
    }
  }, []);

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

        {mode === "login" && (
          <LoginForm
            onRegister={() => setMode("register")}
            onForgotPassword={() => setMode("forgot")}
            onForceChange={(token) => {
              setForceToken(token);
              setMode("force-change");
            }}
            onMfa={(token) => {
              setMfaToken(token);
              setMode("mfa");
            }}
            onSuccess={() => navigate("/")}
            authRedirectError={authRedirectError}
          />
        )}
        {mode === "register" && (
          <RegisterForm onLogin={() => setMode("login")} onSuccess={() => navigate("/")} />
        )}
        {mode === "forgot" && <ForgotPasswordForm onBack={() => setMode("login")} />}
        {mode === "force-change" && (
          <ForceChangeForm
            token={forceToken}
            onSuccess={() => navigate("/")}
            onBack={() => setMode("login")}
          />
        )}
        {mode === "mfa" && (
          <MfaForm
            token={mfaToken}
            onSuccess={() => navigate("/")}
            onBack={() => setMode("login")}
          />
        )}
      </div>
    </div>
  );
}

function LoginForm({
  onRegister,
  onForgotPassword,
  onForceChange,
  onMfa,
  onSuccess,
  authRedirectError,
}: {
  onRegister: () => void;
  onForgotPassword: () => void;
  onForceChange: (token: string) => void;
  onMfa: (token: string) => void;
  onSuccess: () => void;
  authRedirectError?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      if (!window.google?.accounts?.id) {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("No se pudo cargar Google Identity Services"));
          document.head.appendChild(script);
        });
      }

      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || "",
          ux_mode: "popup",
          callback: async (response: { credential: string }) => {
            try {
              const token = await oauthLogin("google", response.credential);
              if (token.force_password_change) {
                storeToken(token.access_token);
                onForceChange(token.access_token);
                return;
              }
              if (token.mfa_required) {
                onMfa(token.access_token);
                return;
              }
              storeToken(token.access_token);
              onSuccess();
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : "Error al autenticar con Google";
              setError(msg);
              setLoading(false);
            }
          },
        });

        window.google.accounts.id.prompt((notification: { isNotDisplayed: () => boolean }) => {
          if (notification.isNotDisplayed()) {
            setError(
              "No se pudo mostrar el popup de Google. Probá deshabilitar el bloqueador de popups.",
            );
            setLoading(false);
          }
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al inicializar Google";
      setError(msg);
      setLoading(false);
    }
  }, [onForceChange, onMfa, onSuccess]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const token = await login(email.trim().toLowerCase(), password);
      if (token.force_password_change) {
        onForceChange(token.access_token);
        return;
      }
      if (token.mfa_required) {
        onMfa(token.access_token);
        return;
      }
      storeToken(token.access_token);
      onSuccess();
    } catch {
      setError("Email o contraseña incorrectos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome p-6 flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-[var(--text-primary)]" htmlFor="email">
            Correo electrónico
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            required
            className="input"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-[var(--text-primary)]" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="input"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onForgotPassword}
            className="text-xs text-[var(--color-primary)] hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </button>
        </div>

        {error && <div className="alert-error">{error}</div>}
        {authRedirectError && <div className="alert-error">{authRedirectError}</div>}

        <button type="submit" disabled={loading} className="gnome-btn-primary w-full mt-1">
          {loading ? "Ingresando..." : "Ingresar"}
        </button>
      </form>

      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-[var(--border-color)]"></div>
        <span className="text-xs text-[var(--text-tertiary)]">o</span>
        <div className="flex-1 h-px bg-[var(--border-color)]"></div>
      </div>

      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-[var(--border-color)] bg-[var(--color-base-container)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--color-base-alt)] transition"
      >
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.05z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continuar con Google
      </button>

      <p className="text-center text-sm text-[var(--text-tertiary)]">
        ¿No tenés cuenta?{" "}
        <button
          type="button"
          onClick={onRegister}
          className="text-[var(--color-primary)] hover:underline font-medium"
        >
          Registrarse
        </button>
      </p>
    </div>
  );
}

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Error al enviar el email. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition flex items-center gap-1"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 12L6 8l4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Volver
        </button>
      </div>

      {sent ? (
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
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Email enviado</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Si el email <strong>{email}</strong> está registrado, recibirás un enlace para
            restablecer tu contraseña.
          </p>
          <button type="button" onClick={onBack} className="gnome-btn-primary w-full">
            Volver al inicio de sesión
          </button>
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Restablecer contraseña
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Ingresá tu email y te enviaremos un enlace para crear una nueva contraseña.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label
                className="text-sm font-medium text-[var(--text-primary)]"
                htmlFor="forgot-email"
              >
                Correo electrónico
              </label>
              <input
                id="forgot-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
                className="input"
              />
            </div>

            {error && <div className="alert-error">{error}</div>}

            <button type="submit" disabled={loading} className="gnome-btn-primary w-full mt-1">
              {loading ? "Enviando..." : "Enviar enlace"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function RegisterForm({ onLogin, onSuccess }: { onLogin: () => void; onSuccess: () => void }) {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Las contraseñas no coinciden");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError("La contraseña debe contener al menos una mayúscula");
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError("La contraseña debe contener al menos una minúscula");
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError("La contraseña debe contener al menos un número");
      return;
    }
    if (!SPECIAL_CHARS.test(password)) {
      setError("La contraseña debe contener al menos un carácter especial (!@#$%^&*...)");
      return;
    }
    setLoading(true);
    try {
      const token = await register(nombre.trim(), email.trim().toLowerCase(), password);
      storeToken(token.access_token);
      onSuccess();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Error al registrar. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onLogin}
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition flex items-center gap-1"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 12L6 8l4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Volver
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Crear cuenta</h2>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-[var(--text-primary)]" htmlFor="nombre">
            Nombre completo
          </label>
          <input
            id="nombre"
            type="text"
            autoComplete="name"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Juan Pérez"
            required
            className="input"
          />
          <span className="text-xs text-[var(--text-tertiary)]">
            Tu nombre tal como aparece en la tarjeta
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-[var(--text-primary)]" htmlFor="reg-email">
            Correo electrónico
          </label>
          <input
            id="reg-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            required
            className="input"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-[var(--text-primary)]" htmlFor="reg-password">
            Contraseña
          </label>
          <input
            id="reg-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="input"
          />
          <span className="text-xs text-[var(--text-tertiary)]">
            Mín. 8 caracteres, 1 mayúscula, 1 minúscula, 1 número, 1 especial (!@#$%^&*...)
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-[var(--text-primary)]" htmlFor="reg-confirm">
            Confirmar contraseña
          </label>
          <input
            id="reg-confirm"
            type="password"
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
          {loading ? "Registrando..." : "Crear cuenta"}
        </button>
      </form>

      <p className="text-center text-sm text-[var(--text-tertiary)]">
        ¿Ya tenés cuenta?{" "}
        <button
          type="button"
          onClick={onLogin}
          className="text-[var(--color-primary)] hover:underline font-medium"
        >
          Iniciar sesión
        </button>
      </p>
    </div>
  );
}

function ForceChangeForm({
  token,
  onSuccess,
  onBack,
}: {
  token: string;
  onSuccess: () => void;
  onBack: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Las contraseñas no coinciden");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError("La contraseña debe contener al menos una mayúscula");
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError("La contraseña debe contener al menos una minúscula");
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError("La contraseña debe contener al menos un número");
      return;
    }
    if (!SPECIAL_CHARS.test(password)) {
      setError("La contraseña debe contener al menos un carácter especial (!@#$%^&*...)");
      return;
    }
    setLoading(true);
    try {
      const result = await forceChangePassword(token, password);
      storeToken(result.access_token);
      onSuccess();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(
        typeof detail === "string" ? detail : "Error al cambiar contraseña. Intentá de nuevo.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Cambio de contraseña obligatorio
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Por seguridad, debés crear una nueva contraseña que cumpla con los requisitos de seguridad
          actualizados.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-[var(--text-primary)]" htmlFor="force-new-pw">
            Nueva contraseña
          </label>
          <input
            id="force-new-pw"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="input"
          />
          <span className="text-xs text-[var(--text-tertiary)]">
            Mín. 8 caracteres, 1 mayúscula, 1 minúscula, 1 número, 1 especial (!@#$%^&*...)
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-sm font-medium text-[var(--text-primary)]"
            htmlFor="force-confirm-pw"
          >
            Confirmar contraseña
          </label>
          <input
            id="force-confirm-pw"
            type="password"
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
          {loading ? "Guardando..." : "Guardar nueva contraseña"}
        </button>
      </form>

      <p className="text-center text-sm text-[var(--text-tertiary)]">
        <button
          type="button"
          onClick={onBack}
          className="text-[var(--color-primary)] hover:underline font-medium"
        >
          Volver al inicio de sesión
        </button>
      </p>
    </div>
  );
}

function MfaForm({
  token,
  onSuccess,
  onBack,
}: {
  token: string;
  onSuccess: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await loginMfa(token, code);
      storeToken(result.access_token);
      onSuccess();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Código MFA incorrecto");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Verificación de seguridad
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Ingresá el código de 6 dígitos de tu aplicación de autenticación (Google Authenticator,
          Authy, etc.).
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-[var(--text-primary)]" htmlFor="mfa-code">
            Código de verificación
          </label>
          <input
            id="mfa-code"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            required
            className="input font-mono text-center text-lg tracking-widest"
            autoFocus
          />
        </div>

        {error && <div className="alert-error">{error}</div>}

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="gnome-btn-primary w-full mt-1"
        >
          {loading ? "Verificando..." : "Verificar"}
        </button>
      </form>

      <p className="text-center text-sm text-[var(--text-tertiary)]">
        <button
          type="button"
          onClick={onBack}
          className="text-[var(--color-primary)] hover:underline font-medium"
        >
          Volver al inicio de sesión
        </button>
      </p>
    </div>
  );
}
