import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, register, storeToken } from '../api/client'

export default function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center font-bold text-xl shadow-neon">
            F
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">
            Financial <span className="text-brand-500">Planning</span>
          </h1>
        </div>

        {mode === 'login'
          ? <LoginForm onRegister={() => setMode('register')} onSuccess={() => navigate('/')} />
          : <RegisterForm onLogin={() => setMode('login')} onSuccess={() => navigate('/')} />
        }
      </div>
    </div>
  )
}

function LoginForm({ onRegister, onSuccess }: { onRegister: () => void; onSuccess: () => void }) {
  const [dni, setDni] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const token = await login(dni.trim(), password)
      storeToken(token.access_token)
      onSuccess()
    } catch {
      setError('DNI o contraseña incorrectos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-8 flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-700" htmlFor="dni">DNI</label>
        <input
          id="dni"
          type="text"
          inputMode="numeric"
          pattern="\d*"
          autoComplete="username"
          value={dni}
          onChange={(e) => setDni(e.target.value)}
          placeholder="00000000"
          required
          className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-700" htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white font-semibold text-sm transition"
      >
        {loading ? 'Ingresando...' : 'Ingresar'}
      </button>

      <p className="text-center text-sm text-zinc-500">
        ¿No tenés cuenta?{' '}
        <button type="button" onClick={onRegister} className="text-brand-600 hover:text-brand-500 font-medium">
          Registrarse
        </button>
      </p>
    </form>
  )
}

function RegisterForm({ onLogin, onSuccess }: { onLogin: () => void; onSuccess: () => void }) {
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [dni, setDni] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    setLoading(true)
    try {
      const full_name = `${apellido.trim()}, ${nombre.trim()}`
      const token = await register(full_name, dni.trim(), password)
      storeToken(token.access_token)
      onSuccess()
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Error al registrar. Intentá de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = "w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
  const labelClass = "text-sm font-medium text-zinc-700"

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-8 flex flex-col gap-4">
      <h2 className="text-base font-semibold text-zinc-900">Crear cuenta</h2>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className={labelClass} htmlFor="nombre">Nombre</label>
          <input
            id="nombre"
            type="text"
            autoComplete="given-name"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Juan"
            required
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass} htmlFor="apellido">Apellido</label>
          <input
            id="apellido"
            type="text"
            autoComplete="family-name"
            value={apellido}
            onChange={(e) => setApellido(e.target.value)}
            placeholder="Pérez"
            required
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass} htmlFor="reg-dni">DNI</label>
        <input
          id="reg-dni"
          type="text"
          inputMode="numeric"
          pattern="\d*"
          autoComplete="username"
          value={dni}
          onChange={(e) => setDni(e.target.value.replace(/\D/g, ''))}
          placeholder="00000000"
          required
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass} htmlFor="reg-password">Contraseña</label>
        <input
          id="reg-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mínimo 6 caracteres"
          required
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass} htmlFor="reg-confirm">Repetir contraseña</label>
        <input
          id="reg-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
          required
          className={inputClass}
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white font-semibold text-sm transition"
      >
        {loading ? 'Registrando...' : 'Crear cuenta'}
      </button>

      <p className="text-center text-sm text-zinc-500">
        ¿Ya tenés cuenta?{' '}
        <button type="button" onClick={onLogin} className="text-brand-600 hover:text-brand-500 font-medium">
          Iniciar sesión
        </button>
      </p>
    </form>
  )
}
