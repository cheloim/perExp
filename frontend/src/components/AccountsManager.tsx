import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAccounts, createAccount, updateAccount, deleteAccount, createCard } from '../api/client'
import type { Account } from '../types'

const ACCOUNT_TYPES = [
  { value: 'efectivo', label: 'Efectivo', color: 'bg-emerald-100 text-emerald-600' },
  { value: 'cuenta_corriente', label: 'Cta. Corriente', color: 'bg-blue-100 text-blue-600' },
  { value: 'caja_ahorro', label: 'Caja de Ahorro', color: 'bg-indigo-100 text-indigo-600' },
  { value: 'mercadopago', label: 'MercadoPago', color: 'bg-purple-100 text-purple-600' },
  { value: 'tarjeta', label: 'Tarjeta', color: 'bg-pink-100 text-pink-600' },
]

const CARD_TYPES = [
  { value: 'credito', label: 'Crédito' },
  { value: 'debito', label: 'Débito' },
]

export default function AccountsManager() {
  const queryClient = useQueryClient()
  const [editId, setEditId] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState('efectivo')
  const [bank, setBank] = useState('')
  const [last4, setLast4] = useState('')
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
    mutationFn: (data: { name: string; bank: string; last4_digits?: string; card_type: string }) => createCard(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      setEditId(null)
      setName('')
      setType('efectivo')
      setBank('')
      setLast4('')
      setCardType('credito')
    },
  })

  const handleEdit = (account: Account) => {
    setEditId(account.id)
    setName(account.name)
    setType(account.type)
    setMenuOpen(null)
  }

  const handleAdd = () => {
    setEditId(-1)
    setName('')
    setType('efectivo')
    setBank('')
    setLast4('')
    setCardType('credito')
    setMenuOpen(null)
  }

  const handleCancel = () => {
    setEditId(null)
    setName('')
    setType('efectivo')
    setBank('')
    setLast4('')
    setCardType('credito')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    if (type === 'tarjeta') {
      if (editId && editId > 0) {
        // Editing would require updateCard - keeping simple for now
        alert('La edición de tarjetas se puede hacer desde la sección de Tarjetas')
        return
      }
      createCardMut.mutate({
        name: name.trim(),
        bank: bank.trim(),
        last4_digits: last4.trim() || undefined,
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

  if (isLoading) return <div className="p-4 text-sm text-zinc-400">Cargando…</div>

  return (
    <div className="px-4 py-4 space-y-2">
      {accounts.map((account) => {
        const typeInfo = ACCOUNT_TYPES.find((t) => t.value === account.type) || ACCOUNT_TYPES[4]
        const isEditing = editId === account.id
        const isMenuOpen = menuOpen === account.id

        return (
          <div key={account.id} className="relative">
            {isEditing ? (
              <form onSubmit={handleSubmit} className="p-3 bg-brand-50 border border-brand-200 rounded-lg space-y-3">
                <div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
                    placeholder={type === 'tarjeta' ? 'Nombre (ej: Visa Galicia)' : 'Nombre de la cuenta'}
                    autoFocus
                    required
                  />
                </div>
                
                {/* Campos de Tarjeta */}
                {type === 'tarjeta' && (
                  <>
                    <div>
                      <input
                        type="text"
                        value={bank}
                        onChange={(e) => setBank(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
                        placeholder="Banco (ej: Galicia)"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        value={last4}
                        onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 font-mono"
                        placeholder="Últimos 4 dígitos (opcional)"
                        maxLength={4}
                      />
                    </div>
                    <select
                      value={cardType}
                      onChange={(e) => setCardType(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
                    >
                      {CARD_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </>
                )}

                {/* Campos de Caja de Ahorro con última tarjeta opcional */}
                {type === 'caja_ahorro' && (
                  <div>
                    <input
                      type="text"
                      value={last4}
                      onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 font-mono"
                      placeholder="Últimos 4 dígitos tarjeta débito (opcional)"
                      maxLength={4}
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={createMut.isPending || updateMut.isPending}
                    className="flex-1 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-500 disabled:opacity-50 transition"
                  >
                    Guardar
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 py-1.5 text-xs font-medium bg-white border border-zinc-300 text-zinc-600 rounded-lg hover:bg-zinc-50 transition"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <div className="group relative flex items-center gap-3 p-3 bg-white border border-zinc-200 rounded-lg hover:border-zinc-300 transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${typeInfo.color}`}>
                  {account.type === 'efectivo' ? '💵' :
                   account.type === 'mercadopago' ? '📱' :
                   account.type === 'cuenta_corriente' ? '🏦' :
                   account.type === 'caja_ahorro' ? '💳' : '💰'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 truncate">{account.name}</div>
                  <div className="text-xs text-zinc-400">{typeInfo.label}</div>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen(isMenuOpen ? null : account.id)}
                    className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
                  >
                    ···
                  </button>
                  {isMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(null)} />
                      <div className="absolute right-0 top-8 z-50 w-28 bg-white border border-zinc-200 rounded-lg shadow-lg overflow-hidden">
                        <button
                          onClick={() => handleEdit(account)}
                          className="w-full px-3 py-2 text-xs text-left text-zinc-700 hover:bg-zinc-50 transition-colors"
                        >
                          ✏️ Editar
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`¿Eliminar "${account.name}"?`)) {
                              deleteMut.mutate(account.id)
                            }
                          }}
                          disabled={deleteMut.isPending}
                          className="w-full px-3 py-2 text-xs text-left text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
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

      {editId === -1 && (
        <form onSubmit={handleSubmit} className="p-3 bg-brand-50 border border-brand-200 rounded-lg space-y-3">
          <div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="Nombre de la cuenta"
              autoFocus
              required
            />
          </div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createMut.isPending || updateMut.isPending}
              className="flex-1 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-500 disabled:opacity-50 transition"
            >
              Crear
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 py-1.5 text-xs font-medium bg-white border border-zinc-300 text-zinc-600 rounded-lg hover:bg-zinc-50 transition"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {accounts.length === 0 && editId !== -1 && (
        <div className="text-center py-8 px-4">
          <p className="text-sm text-zinc-500 mb-3">No hay cuentas registradas</p>
          <button
            onClick={handleAdd}
            className="px-4 py-2 text-sm bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors font-medium"
          >
            + Nueva Cuenta
          </button>
        </div>
      )}

      {editId === null && accounts.length > 0 && (
        <button
          onClick={handleAdd}
          className="w-full py-2.5 border-2 border-dashed border-zinc-200 rounded-lg text-sm text-zinc-500 hover:border-brand-300 hover:text-brand-500 transition-colors"
        >
          + Agregar cuenta
        </button>
      )}
    </div>
  )
}
