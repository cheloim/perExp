import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getMe, changePassword, clearToken, getMyGroup, inviteToGroup, leaveGroup, getTelegramKey, regenerateTelegramKey } from '../api/client'
import { useNavigate } from 'react-router-dom'
import AccountsManager from './AccountsManager'
import CardsManager from './CardsManager'

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
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'config' | 'accounts'>('config')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [inviteDni, setInviteDni] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)

  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    enabled: open,
  })

  const { data: myGroup } = useQuery({
    queryKey: ['my-group'],
    queryFn: getMyGroup,
    enabled: open,
  })

  const { data: tgKeyData, refetch: refetchTgKey } = useQuery({
    queryKey: ['telegram-key'],
    queryFn: getTelegramKey,
    enabled: open,
  })

  const regenerateKeyMut = useMutation({
    mutationFn: regenerateTelegramKey,
    onSuccess: () => { refetchTgKey() },
  })

  const handleCopyKey = () => {
    if (!tgKeyData?.telegram_key) return
    navigator.clipboard.writeText(tgKeyData.telegram_key)
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 2000)
  }

  const inviteMut = useMutation({
    mutationFn: () => inviteToGroup(inviteDni.trim()),
    onSuccess: () => {
      setInviteSuccess(true)
      setInviteError(null)
      setInviteDni('')
      queryClient.invalidateQueries({ queryKey: ['my-group'] })
    },
    onError: (e: any) => {
      setInviteError(e?.response?.data?.detail ?? 'Error al enviar invitación')
      setInviteSuccess(false)
    },
  })

  const leaveMut = useMutation({
    mutationFn: leaveGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-group'] })
    },
    onError: (e: any) => {
      setInviteError(e?.response?.data?.detail ?? 'Error al salir del grupo')
    },
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
        <div className="border-b border-zinc-100">
            <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-base font-semibold text-zinc-900">Mi cuenta</h2>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 transition-colors">
              ✕
            </button>
          </div>
          {/* Pill segmented nav */}
          <div className="flex gap-1 p-1 mx-4 mb-1 bg-zinc-100 rounded-xl">
            <button
              onClick={() => setActiveTab('config')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'config'
                  ? 'bg-white shadow-sm text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Config
            </button>
            <button
              onClick={() => setActiveTab('accounts')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'accounts'
                  ? 'bg-white shadow-sm text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Cuentas
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">{activeTab === 'config' && (
          <div className="px-4 py-4 space-y-6">
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

          <hr className="border-zinc-100" />

          {/* Family Group */}
          <div>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">👨‍👩‍👧 Grupo Familiar</h3>

            {myGroup ? (
              <div className="space-y-3">
                <p className="text-xs text-zinc-500">{myGroup.name}</p>
                <ul className="space-y-1.5">
                  {myGroup.members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px] font-bold">
                          {formatFullName(m.full_name)[0]?.toUpperCase() ?? '?'}
                        </span>
                        <span className="text-xs text-zinc-700">{formatFullName(m.full_name)}</span>
                      </div>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        m.status === 'accepted' ? 'bg-emerald-100 text-emerald-700'
                        : m.status === 'pending' ? 'bg-amber-100 text-amber-700'
                        : 'bg-zinc-100 text-zinc-500'
                      }`}>
                        {m.status === 'accepted' ? 'Activo' : m.status === 'pending' ? 'Pendiente' : m.status}
                      </span>
                    </li>
                  ))}
                </ul>

                {myGroup.members.length < 5 && (
                  <form onSubmit={(e) => { e.preventDefault(); setInviteError(null); setInviteSuccess(false); inviteMut.mutate() }} className="space-y-2">
                    <input
                      type="text"
                      value={inviteDni}
                      onChange={(e) => setInviteDni(e.target.value)}
                      placeholder="DNI del familiar a invitar"
                      required
                      className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 transition"
                    />
                    <button
                      type="submit"
                      disabled={inviteMut.isPending || !inviteDni.trim()}
                      className="w-full py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white text-xs font-medium transition"
                    >
                      {inviteMut.isPending ? 'Invitando…' : 'Invitar familiar'}
                    </button>
                  </form>
                )}

                {inviteError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{inviteError}</p>}
                {inviteSuccess && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">Invitación enviada</p>}

                <button
                  onClick={() => leaveMut.mutate()}
                  disabled={leaveMut.isPending}
                  className="w-full py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 text-xs font-medium transition disabled:opacity-50"
                >
                  {leaveMut.isPending ? 'Saliendo…' : 'Salir del grupo'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">No pertenecés a ningún grupo familiar. Invitá a un familiar con su DNI.</p>
                <form onSubmit={(e) => { e.preventDefault(); setInviteError(null); setInviteSuccess(false); inviteMut.mutate() }} className="space-y-2">
                  <input
                    type="text"
                    value={inviteDni}
                    onChange={(e) => setInviteDni(e.target.value)}
                    placeholder="DNI del familiar"
                    required
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 transition"
                  />
                  <button
                    type="submit"
                    disabled={inviteMut.isPending || !inviteDni.trim()}
                    className="w-full py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white text-xs font-medium transition"
                  >
                    {inviteMut.isPending ? 'Enviando…' : 'Crear grupo e invitar'}
                  </button>
                </form>
                {inviteError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{inviteError}</p>}
                {inviteSuccess && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">Invitación enviada</p>}
              </div>
            )}
          </div>

          <hr className="border-zinc-100" />

          {/* Telegram Bot */}
          <div>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">Telegram Bot</h3>
            <p className="text-xs text-zinc-500 mb-3">
              Enviá <span className="font-mono bg-zinc-100 px-1 rounded">/start</span> al bot y pegá esta clave para autenticarte.
            </p>
            <div className="flex items-center gap-2">
              <span className="flex-1 font-mono text-sm bg-zinc-100 rounded-lg px-3 py-2 tracking-widest text-zinc-800 select-all">
                {tgKeyData?.telegram_key ?? '············'}
              </span>
              <button
                onClick={handleCopyKey}
                className="px-3 py-2 rounded-lg border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-50 transition"
              >
                {keyCopied ? '✓' : 'Copiar'}
              </button>
            </div>
            <button
              onClick={() => regenerateKeyMut.mutate()}
              disabled={regenerateKeyMut.isPending}
              className="mt-2 w-full py-1.5 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 text-xs font-medium transition disabled:opacity-50"
            >
              {regenerateKeyMut.isPending ? 'Regenerando…' : 'Regenerar clave'}
            </button>
          </div>
          </div>
        )}

        {activeTab === 'accounts' && (
          <div className="space-y-1">
            <AccountsManager />
            <CardsManager />
          </div>
        )}
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
