import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google'
import { login, register, oauthLogin, storeToken } from '../api/client'

const GOOGLE_CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || ''

export default function LoginPage() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <LoginContent />
    </GoogleOAuthProvider>
  )
}

function LoginContent() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')

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

        {mode === 'login'
          ? <LoginForm onRegister={() => setMode('register')} onSuccess={() => navigate('/')} />
          : <RegisterForm onLogin={() => setMode('login')} onSuccess={() => navigate('/')} />
        }
      </div>
    </div>
  )
}

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

function LoginForm({ onRegister, onSuccess }: { onRegister: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleGoogleClick = () => {
    if (!isLocalhost) {
      setError('Google OAuth is a WIP. Come back later.')
      return
    }
    googleLogin()
  }

  const googleLogin = useGoogleLogin({
    onSuccess: async (response: any) => {
      window.location.href = `/oauth/google/callback?code=${response.code}`
    },
    onError: () => {
      setError('Error al iniciar sesión con Google')
    },
    flow: 'auth-code',
    ux_mode: 'redirect',
    redirect_uri: `${window.location.origin}/oauth/google/callback`,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const token = await login(email.trim().toLowerCase(), password)
      storeToken(token.access_token)
      onSuccess()
    } catch {
      setError('Email o contraseña incorrectos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome p-8 flex flex-col gap-5">
      <button
        type="button"
        onClick={handleGoogleClick}
        disabled={loading}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continuar con Google
      </button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[var(--border-color)]"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-[var(--color-surface)] text-[var(--text-tertiary)]">o</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--text-secondary)]" htmlFor="email">Email</label>
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

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--text-secondary)]" htmlFor="password">Contraseña</label>
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

        {error && (
          <div className="alert-error">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full"
        >
          {loading ? 'Ingresando...' : 'Ingresar con email'}
        </button>
      </form>

      <p className="text-center text-sm text-[var(--text-tertiary)]">
        ¿No tenés cuenta?{' '}
        <button type="button" onClick={onRegister} className="text-[var(--color-primary)] hover:underline font-medium">
          Registrarse
        </button>
      </p>
    </div>
  )
}

function RegisterForm({ onLogin, onSuccess }: { onLogin: () => void; onSuccess: () => void }) {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
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
      const token = await register(nombre.trim(), email.trim().toLowerCase(), password)
      storeToken(token.access_token)
      onSuccess()
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Error al registrar. Intentá de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleClickRegister = () => {
    if (!isLocalhost) {
      setError('Google OAuth is a WIP. Come back later.')
      return
    }
    googleLoginRegister()
  }

  const googleLoginRegister = useGoogleLogin({
    onSuccess: async (response: any) => {
      setLoading(true)
      try {
        const token = await oauthLogin('google', response.credential)
        storeToken(token.access_token)
        onSuccess()
      } catch (err: any) {
        setError(err?.response?.data?.detail || 'Error con Google')
      } finally {
        setLoading(false)
      }
    },
    onError: () => {
      setError('Error al iniciar sesión con Google')
    },
    flow: 'auth-code',
    ux_mode: 'redirect',
    redirect_uri: `${window.location.origin}/oauth/google/callback`,
  })

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome p-8 flex flex-col gap-4">
      <button
        type="button"
        onClick={handleGoogleClickRegister}
        disabled={loading}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continuar con Google
      </button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[var(--border-color)]"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-[var(--color-surface)] text-[var(--text-tertiary)]">o</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Crear cuenta</h2>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--text-secondary)]" htmlFor="nombre">Nombre completo</label>
          <input id="nombre" type="text" autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Juan Pérez" required className="input" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--text-secondary)]" htmlFor="reg-email">Email</label>
          <input id="reg-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" required className="input" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--text-secondary)]" htmlFor="reg-password">Contraseña</label>
          <input id="reg-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required className="input" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--text-secondary)]" htmlFor="reg-confirm">Repetir contraseña</label>
          <input id="reg-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" required className="input" />
        </div>

        {error && (
          <div className="alert-error">{error}</div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Registrando...' : 'Crear cuenta'}
        </button>
      </form>

      <p className="text-center text-sm text-[var(--text-tertiary)]">
        ¿Ya tenés cuenta?{' '}
        <button type="button" onClick={onLogin} className="text-[var(--color-primary)] hover:underline font-medium">
          Iniciar sesión
        </button>
      </p>
    </div>
  )
}