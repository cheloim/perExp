import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAccounts, createAccount, updateAccount, deleteAccount, createCard } from '../api/client'
import type { Account } from '../types'
import { Select } from './Select'

const ACCOUNT_TYPES = [
  { value: 'efectivo', label: 'Efectivo', color: 'badge-success' },
  { value: 'cuenta_corriente', label: 'Cta. Corriente', color: 'badge-primary' },
  { value: 'caja_ahorro', label: 'Caja de Ahorro', color: 'badge-warning' },
  { value: 'mercadopago', label: 'MercadoPago', color: 'badge-neutral' },
  { value: 'tarjeta', label: 'Tarjeta', color: 'badge-neutral' },
]

const CARD_TYPES = [
  { value: 'credito', label: 'Crédito' },
  { value: 'debito', label: 'Débito' },
]

export default function AccountsManager() {
  const queryClient = useQueryClient()
  const [editId, setEditId] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState<number | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'account'; id: number; name: string } | null>(null)
  const [duplicateFound, setDuplicateFound] = useState<{ id: number; name: string; type: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState('efectivo')
  const [bank, setBank] = useState('')
  const [cardType, setCardType] = useState('credito')

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: getAccounts,
  })

  const createMut = useMutation({
    mutationFn: createAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setEditId(null)
      setName('')
      setType('efectivo')
    },
    onError: (error: any) => {
      if (error.response?.status === 409) {
        const detail = error.response.data.detail
        setDuplicateFound({
          id: detail.existing_id,
          name: detail.existing_name,
          type: detail.existing_type,
        })
      }
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; type?: string } }) =>
      updateAccount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setEditId(null)
      setName('')
      setType('efectivo')
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setMenuOpen(null)
    },
  })

  const createCardMut = useMutation({
    mutationFn: (data: { name: string; bank: string; card_type: string }) => createCard(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      setEditId(null)
      setName('')
      setType('efectivo')
      setBank('')
      setCardType('credito')
    },
  })

  const handleEdit = (account: Account) => {
    setEditId(account.id)
    setName(account.name)
    setType(account.type)
    setMenuOpen(null)
  }

  const handleCancel = () => {
    setEditId(null)
    setName('')
    setType('efectivo')
    setBank('')
    setCardType('credito')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('El nombre es obligatorio')
      return
    }
    setError(null)

    if (type === 'tarjeta') {
      if (editId && editId > 0) {
        alert('La edición de tarjetas se puede hacer desde la sección de Tarjetas')
        return
      }
      if (!bank.trim()) {
        setError('El banco es obligatorio')
        return
      }
      createCardMut.mutate({
        name: name.trim(),
        bank: bank.trim(),
        card_type: cardType,
      })
    } else {
      if (editId && editId > 0) {
        updateMut.mutate({ id: editId, data: { name: name.trim(), type } })
      } else {
        createMut.mutate({ name: name.trim(), type })
      }
    }
  }

  if (isLoading) return <div className="p-4 text-sm text-tertiary">Cargando…</div>

  return (
    <div className="px-4 py-2 space-y-2">
      <h3 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Cuentas</h3>
      {accounts.map((account) => {
        const typeInfo = ACCOUNT_TYPES.find((t) => t.value === account.type) || ACCOUNT_TYPES[4]
        const isEditing = editId === account.id
        const isMenuOpen = menuOpen === account.id

        return (
          <div key={account.id} className="relative">
            {isEditing ? (
              <form onSubmit={handleSubmit} className="p-4 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg space-y-4">
                {/* Nombre */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">Nombre</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => { setName(e.target.value); setError(null) }}
                    className={`w-full px-3 py-2 rounded-md border text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 transition ${error ? 'border-red-500 focus:ring-red-300 focus:border-red-500' : 'border-[var(--border-color)] focus:border-primary'}`}
                    placeholder={type === 'tarjeta' ? 'Ej: Visa Galicia' : 'Ej: Mi Cuenta'}
                    autoFocus
                  />
                  {error && <p className="text-xs text-red-500">{error}</p>}
                </div>

                {/* Tipo de cuenta */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">Tipo de cuenta</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  >
                    <option value="efectivo">💵 Efectivo</option>
                    <option value="cuenta_corriente">🏦 Cuenta Corriente</option>
                    <option value="caja_ahorro">💳 Caja de Ahorro</option>
                    <option value="mercadopago">📱 MercadoPago</option>
                    <option value="tarjeta">💰 Tarjeta</option>
                  </select>
                </div>

                {/* Campos de Tarjeta */}
                {type === 'tarjeta' && (
                  <div className="space-y-3 pt-2 border-t border-[var(--border-color)]">
                    {/* Tipo: Crédito/Débito */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--text-secondary)]">Tipo de tarjeta</label>
                      <Select
                        value={cardType}
                        onChange={v => setCardType(v)}
                        options={CARD_TYPES.map(t => ({ value: t.value, label: t.label }))}
                      />
                    </div>

                    {/* Banco */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--text-secondary)]">Banco</label>
                      <input
                        type="text"
                        value={bank}
                        onChange={(e) => { setBank(e.target.value); setError(null) }}
                        className={`w-full px-3 py-2 rounded-md border text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 transition ${error && type === 'tarjeta' && !bank.trim() ? 'border-red-500 focus:ring-red-300 focus:border-red-500' : 'border-[var(--border-color)] focus:border-primary'}`}
                        placeholder="Ej: Galicia"
                      />
                    </div>
                  </div>
                )}

                {/* Botones */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={createMut.isPending || updateMut.isPending}
                    className="flex-1 px-4 py-2 rounded-md bg-[var(--color-primary)] text-[var(--color-on-primary)] text-sm font-medium hover:brightness-110 disabled:opacity-60 transition"
                  >
                    {createMut.isPending || updateMut.isPending ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <div className="group relative flex items-center gap-3 p-3 bg-surface border border-border-color rounded-lg hover:border-border-color transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${typeInfo.color}`}>
                  {account.type === 'efectivo' ? '💵' :
                   account.type === 'mercadopago' ? '📱' :
                   account.type === 'cuenta_corriente' ? '🏦' :
                   account.type === 'caja_ahorro' ? '💳' : '💰'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-primary truncate">{account.name}</div>
                  <div className="text-xs text-secondary">{typeInfo.label}</div>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen(isMenuOpen ? null : account.id)}
                    className="w-7 h-7 flex items-center justify-center rounded text-tertiary hover:text-primary hover:bg-base-alt transition-colors"
                  >
                    ···
                  </button>
                  {isMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(null)} />
                      <div className="absolute right-0 top-8 z-50 w-28 bg-surface border border-border-color rounded-lg shadow-lg overflow-hidden">
                        <button
                          onClick={() => handleEdit(account)}
                          className="w-full px-3 py-2 text-xs text-left text-primary hover:bg-base-alt transition-colors"
                        >
                          ✏️ Editar
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'account', id: account.id, name: account.name })}
                          disabled={deleteMut.isPending}
                          className="w-full px-3 py-2 text-xs text-left text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                        >
                          🗑️ Eliminar
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-[var(--color-surface)] rounded-xl shadow-gnome-lg p-6 max-w-sm w-full border border-[var(--border-color)]">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Confirmar eliminación</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-6">
              ¿Estás seguro de eliminar <span className="font-medium text-[var(--color-primary)]">"{deleteConfirm.name}"</span>? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  deleteMut.mutate(deleteConfirm.id)
                  setDeleteConfirm(null)
                }}
                disabled={deleteMut.isPending}
                className="flex-1 px-4 py-2 rounded-md bg-[var(--color-danger)] text-white text-sm font-medium hover:brightness-110 disabled:opacity-60 transition"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateFound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-[var(--color-surface)] rounded-xl shadow-gnome-lg p-6 max-w-sm w-full border border-[var(--border-color)]">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Cuenta existente</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-6">
              Ya existe una cuenta con estos datos: <span className="font-medium text-[var(--color-primary)]">"{duplicateFound.name}"</span> ({duplicateFound.type})
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDuplicateFound(null)
                  setName('')
                  setType('efectivo')
                  setEditId(null)
                }}
                className="flex-1 px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const accountToEdit = accounts.find(a => a.id === duplicateFound.id)
                  if (accountToEdit) {
                    setEditId(duplicateFound.id)
                    setName(duplicateFound.name)
                    setType(duplicateFound.type)
                  }
                  setDuplicateFound(null)
                }}
                className="flex-1 px-4 py-2 rounded-md bg-[var(--color-primary)] text-[var(--color-on-primary)] text-sm font-medium hover:brightness-110 transition"
              >
                Editar existente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
