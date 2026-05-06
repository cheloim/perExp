import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getMe, changePassword, clearToken } from '../api/client'
import { useNavigate } from 'react-router-dom'

interface Props {
  open: boolean
  onClose: () => void
}

function formatFullName(full_name: string) {
  // stored as "Apellido, Nombre" — display as "Nombre Apellido"
  if (full_name.includes(',')) {
    const [apellido, nombre] = full_name.split(',').map(s => s.trim())
    return `${nombre} ${apellido}`
  }
  return full_name
}

export default function UserPanel({ open, onClose }: Props) {
  const navigate = useNavigate()
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)

  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    enabled: open,
  })

  const changePwMut = useMutation({
    mutationFn: () => changePassword(currentPw, newPw),
    onSuccess: () => {
      setPwSuccess(true)
      setPwError(null)
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
    },
    onError: (e: any) => {
      setPwError(e?.response?.data?.detail ?? 'Error al cambiar contraseña')
    },
  })

  const handleChangePw = (e: React.FormEvent) => {
    e.preventDefault()
    setPwError(null)
    setPwSuccess(false)
    if (newPw !== confirmPw) { setPwError('Las contraseñas no coinciden'); return }
    if (newPw.length < 6) { setPwError('Mínimo 6 caracteres'); return }
    changePwMut.mutate()
  }

  const handleLogout = () => {
    clearToken()
    navigate('/login')
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      )}

      {/* Panel */}
      <div
        className={`fixed bottom-0 left-0 z-50 h-full w-72 bg-white border-r border-zinc-200 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="text-base font-semibold text-zinc-900">Mi cuenta</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 transition-colors">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* User info */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
              {user ? formatFullName(user.full_name)[0].toUpperCase() : '?'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 truncate">
                {user ? formatFullName(user.full_name) : '—'}
              </p>
              <p className="text-xs text-zinc-400">DNI {user?.dni ?? '—'}</p>
            </div>
          </div>

          <hr className="border-zinc-100" />

          {/* Change password */}
          <div>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">Cambiar contraseña</h3>
            <form onSubmit={handleChangePw} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Contraseña actual</label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={e => { setCurrentPw(e.target.value); setPwSuccess(false) }}
                  placeholder="••••••••"
                  required
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Nueva contraseña</label>
                <input
                  type="password"
                  value={newPw}
                  onChange={e => { setNewPw(e.target.value); setPwSuccess(false) }}
                  placeholder="Mínimo 6 caracteres"
                  required
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Repetir nueva contraseña</label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={e => { setConfirmPw(e.target.value); setPwSuccess(false) }}
                  placeholder="••••••••"
                  required
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
                />
              </div>

              {pwError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{pwError}</p>
              )}
              {pwSuccess && (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  Contraseña actualizada correctamente
                </p>
              )}

              <button
                type="submit"
                disabled={changePwMut.isPending}
                className="w-full py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white font-semibold text-sm transition"
              >
                {changePwMut.isPending ? 'Guardando...' : 'Guardar contraseña'}
              </button>
            </form>
          </div>
        </div>

        {/* Logout */}
        <div className="px-5 py-4 border-t border-zinc-100">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 text-sm font-medium transition-colors"
          >
            <span>→</span>
            Cerrar sesión
          </button>
        </div>
      </div>
    </>
  )
}
