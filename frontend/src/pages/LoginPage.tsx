import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, register, storeToken } from "../api/client";

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");

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

        {mode === "login" ? (
          <LoginForm onRegister={() => setMode("register")} onSuccess={() => navigate("/")} />
        ) : (
          <RegisterForm onLogin={() => setMode("login")} onSuccess={() => navigate("/")} />
        )}
      </div>
    </div>
  );
}

function LoginForm({ onRegister, onSuccess }: { onRegister: () => void; onSuccess: () => void }) {
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
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
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
          <span className="text-xs text-[var(--text-tertiary)]">Tu nombre tal como aparece en la tarjeta</span>
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
          <label
            className="text-sm font-medium text-[var(--text-primary)]"
            htmlFor="reg-password"
          >
            Contraseña
          </label>
          <input
            id="reg-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 6 caracteres"
            required
            className="input"
          />
          <span className="text-xs text-[var(--text-tertiary)]">Mínimo 6 caracteres</span>
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
