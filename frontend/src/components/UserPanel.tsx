import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getMe, changePassword, clearToken, getMyGroup, inviteToGroup, leaveGroup, getTelegramKey, regenerateTelegramKey, getMyInviteCode, generateInviteCode } from '../api/client'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
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
  const { theme, toggleTheme } = useTheme()
  const [activeTab, setActiveTab] = useState<'config' | 'accounts'>('config')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const [showTelegramKey, setShowTelegramKey] = useState(false)

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

  const { data: myInviteCode } = useQuery({
    queryKey: ['my-invite-code'],
    queryFn: getMyInviteCode,
    enabled: open,
  })

  const regenerateInviteCodeMut = useMutation({
    mutationFn: generateInviteCode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-invite-code'] })
    },
  })

  const inviteMut = useMutation({
    mutationFn: () => inviteToGroup(inviteCode.trim()),
    onSuccess: () => {
      setInviteSuccess(true)
      setInviteError(null)
      setInviteCode('')
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
        <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      )}

      {/* Panel */}
      <div
        className={`fixed bottom-0 left-0 z-50 h-full w-72 bg-[var(--color-surface)] border-r border-[var(--border-color)] shadow-gnome-lg flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="border-b border-border-color">
            <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-base font-semibold text-panel-title">Mi cuenta</h2>
            <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
              ✕
            </button>
          </div>
          {/* Pill segmented nav */}
          <div className="flex gap-1 p-1 mx-4 mb-1 bg-[var(--color-base-alt)] rounded-lg">
            <button
              onClick={() => setActiveTab('config')}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'config'
                  ? 'bg-[var(--color-surface)] shadow-sm text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Config
            </button>
            <button
              onClick={() => setActiveTab('accounts')}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'accounts'
                  ? 'bg-[var(--color-surface)] shadow-sm text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
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
            <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
              {user ? formatFullName(user.full_name)[0].toUpperCase() : '?'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text-secondary)] truncate">
                {user ? formatFullName(user.full_name) : '—'}
              </p>
              <p className="text-xs text-[var(--text-tertiary)]">{user?.email ?? '—'}</p>
            </div>
          </div>

          {/* Theme toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">Tema</span>
            <button
              onClick={toggleTheme}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-base-alt)] text-[var(--text-primary)] hover:brightness-90 transition-all"
            >
              {theme === 'dark' ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 3v1m0 8v1M3 8h1m8 0h1M4.22 4.22l.7.7m5.08 5.08l.7.7M4.22 11.78l.7-.7m5.08-5.08l.7-.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  Oscuro
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M14 10.5a6 6 0 01-10.3-6A6 6 0 0114 10.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                  Claro
                </>
              )}
            </button>
          </div>

          {/* Family Group */}
          <div>
            <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-3">Grupo Familiar</h3>
            
            {/* Tu código de invitación */}
            <div className="mb-3 p-2 bg-[var(--color-base-alt)] rounded-md">
              <p className="text-xs text-[var(--text-tertiary)] mb-1">Tu código:</p>
              <div className="flex items-center gap-2">
                <span className="flex-1 font-mono text-sm text-[var(--text-primary)] select-all">
                  {myInviteCode?.invite_code ?? '—'}
                </span>
                {myInviteCode?.invite_code && (
                  <>
                    <button
                      onClick={() => navigator.clipboard.writeText(myInviteCode.invite_code)}
                      className="p-1.5 rounded hover:bg-[var(--color-base)] text-[var(--text-tertiary)] hover:text-primary transition"
                      title="Copiar"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.5"/><path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2" stroke="currentColor" strokeWidth="1.5"/></svg>
                    </button>
                    <button
                      onClick={() => regenerateInviteCodeMut.mutate()}
                      className="p-1.5 rounded hover:bg-[var(--color-base)] text-[var(--text-tertiary)] hover:text-primary transition"
                      title="Nuevo código"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.65 2.35A8 8 0 103.43 11.07l-1.07-1.07M13.65 2.35h-3.5M13.65 2.35v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  </>
                )}
              </div>
            </div>

            {myGroup ? (
              <div className="space-y-3">
                <p className="text-xs text-[var(--text-tertiary)]">{myGroup.name}</p>
                <ul className="space-y-1.5">
                  {myGroup.members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-[var(--color-base-alt)] text-[var(--text-secondary)] flex items-center justify-center text-[10px] font-semibold">
                          {formatFullName(m.full_name)[0]?.toUpperCase() ?? '?'}
                        </span>
                        <span className="text-xs text-[var(--text-primary)]">{formatFullName(m.full_name)}</span>
                      </div>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        m.status === 'accepted' ? 'bg-[var(--gnome-green-3,#33d17a)]/20 text-[var(--gnome-green-5,#26a269)]'
                        : m.status === 'pending' ? 'bg-[var(--gnome-yellow-3,#f6d32d)]/20 text-[var(--gnome-yellow-5,#e5a50a)]'
                        : 'bg-[var(--color-base-alt)] text-[var(--text-tertiary)]'
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
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="Código de invitación del familiar"
                      required
                      className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                    />
                    <button
                      type="submit"
                      disabled={inviteMut.isPending || !inviteCode.trim()}
                      className="w-full py-1.5 rounded-md bg-primary hover:brightness-110 disabled:opacity-60 text-[var(--color-on-primary)] text-xs font-medium transition"
                    >
                      {inviteMut.isPending ? 'Invitando…' : 'Invitar familiar'}
                    </button>
                  </form>
                )}

                {inviteError && <p className="text-xs text-[var(--red-3,#e01b24)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">{inviteError}</p>}
                {inviteSuccess && <p className="text-xs text-[var(--green-5,#26a269)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">Invitación enviada</p>}

                <button
                  onClick={() => leaveMut.mutate()}
                  disabled={leaveMut.isPending}
                  className="w-full py-1.5 rounded-md border border-[var(--red-3,#e01b24)]/30 text-[var(--red-3,#e01b24)] hover:bg-[var(--red-3,#e01b24)]/10 text-xs font-medium transition disabled:opacity-50"
                >
                  {leaveMut.isPending ? 'Saliendo…' : 'Salir del grupo'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-[var(--text-tertiary)]">No pertenecés a ningún grupo familiar. Ingresá el código de invitación de tu familiar.</p>
                <form onSubmit={(e) => { e.preventDefault(); setInviteError(null); setInviteSuccess(false); inviteMut.mutate() }} className="space-y-2">
                  <input
                    type="text"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="Código de invitación"
                    required
                    className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  />
                  <button
                    type="submit"
                    disabled={inviteMut.isPending || !inviteCode.trim()}
                    className="w-full py-1.5 rounded-md bg-primary hover:brightness-110 disabled:opacity-60 text-[var(--color-on-primary)] text-xs font-medium transition"
                  >
                    {inviteMut.isPending ? 'Enviando…' : 'Crear grupo e invitar'}
                  </button>
                </form>
                {inviteError && <p className="text-xs text-[var(--red-3,#e01b24)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">{inviteError}</p>}
                {inviteSuccess && <p className="text-xs text-[var(--green-5,#26a269)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">Invitación enviada</p>}
              </div>
            )}
          </div>

          <hr className="border-[var(--border-color)]" />

          {/* Telegram Bot */}
          <div>
            <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-3">Telegram Bot</h3>
            <p className="text-xs text-[var(--text-tertiary)] mb-3">
              Enviá <span className="font-mono bg-[var(--color-base-alt)] px-1 rounded">/start</span> al bot y pegá esta clave para autenticarte.
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`flex-1 font-mono text-sm bg-[var(--color-base-alt)] rounded-md px-3 py-2 tracking-widest text-[var(--text-primary)] select-all ${!showTelegramKey ? 'blur-sm' : ''}`}>
                  {tgKeyData?.telegram_key ?? '············'}
                </span>
                <button
                  onClick={handleCopyKey}
                  className="px-3 py-2 rounded-md border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
                >
                  {keyCopied ? '✓' : 'Copiar'}
                </button>
              </div>
              <button
                onClick={() => regenerateKeyMut.mutate()}
                disabled={regenerateKeyMut.isPending}
                className="w-full py-1.5 rounded-md border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition disabled:opacity-50"
              >
                {regenerateKeyMut.isPending ? 'Regenerando…' : 'Regenerar clave'}
              </button>
            </div>
            {!showTelegramKey && (
              <p className="text-xs text-[var(--text-tertiary)] mt-2">
                <button onClick={() => setShowTelegramKey(true)} className="text-primary hover:underline">Mostrar clave</button>
              </p>
            )}
          </div>

          <hr className="border-[var(--border-color)]" />

          {/* Change password */}
          <div>
            <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-3">Cambiar contraseña</h3>
            <form onSubmit={handleChangePw} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Contraseña actual</label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={e => { setCurrentPw(e.target.value); setPwSuccess(false) }}
                  placeholder="••••••••"
                  required
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Nueva contraseña</label>
                <input
                  type="password"
                  value={newPw}
                  onChange={e => { setNewPw(e.target.value); setPwSuccess(false) }}
                  placeholder="Mínimo 6 caracteres"
                  required
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Repetir nueva contraseña</label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={e => { setConfirmPw(e.target.value); setPwSuccess(false) }}
                  placeholder="••••••••"
                  required
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                />
              </div>

              {pwError && (
                <p className="text-xs text-[var(--red-3,#e01b24)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">{pwError}</p>
              )}
              {pwSuccess && (
                <p className="text-xs text-[var(--green-5,#26a269)] bg-[var(--color-base)] border border-[var(--border-color)] rounded-md px-3 py-2">
                  Contraseña actualizada correctamente
                </p>
              )}

              <button
                type="submit"
                disabled={changePwMut.isPending}
                className="w-full py-2 rounded-md bg-primary hover:brightness-110 disabled:opacity-60 text-[var(--color-on-primary)] font-medium text-sm transition"
              >
                {changePwMut.isPending ? 'Guardando...' : 'Guardar contraseña'}
              </button>
            </form>
          </div>
          </div>
        )}

        {activeTab === 'accounts' && (
          <div className="space-y-0">
            <AccountsManager />
            <CardsManager />
          </div>
        )}
        </div>

        {/* Logout */}
        <div className="px-5 py-4 border-t border-[var(--border-color)]">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md border border-[var(--red-3,#e01b24)]/30 text-[var(--red-3,#e01b24)] hover:bg-[var(--red-3,#e01b24)]/10 text-sm font-medium transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3H3a1 1 0 00-1 1v8a1 1 0 001 1h3M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Cerrar sesión
          </button>
        </div>
      </div>
    </>
  )
}
