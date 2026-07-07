import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  forgotPassword,
  forceChangePassword,
  login,
  loginMfa,
  register,
  storeToken,
} from "../api/client";

const SPECIAL_CHARS = /[!@#$%^&*()\-_+=<>?/[\]{}|]/;

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "force-change" | "mfa">(
    "login",
  );
  const [forceToken, setForceToken] = useState("");
  const [mfaToken, setMfaToken] = useState("");

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-12 h-12 rounded-lg bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-xl shadow-gnome">
            F
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
            Niko<span className="text-[var(--color-primary)]">Fin</span>
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
}: {
  onRegister: () => void;
  onForgotPassword: () => void;
  onForceChange: (token: string) => void;
  onMfa: (token: string) => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

        <button type="submit" disabled={loading} className="gnome-btn-primary w-full mt-1">
          {loading ? "Ingresando..." : "Ingresar"}
        </button>
      </form>

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
