import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCards, createCard, updateCard, deleteCard, createAccount } from '../api/client'
import type { Card } from '../types'

const ACCOUNT_TYPES = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'cuenta_corriente', label: 'Cta. Corriente' },
  { value: 'caja_ahorro', label: 'Caja de Ahorro' },
  { value: 'mercadopago', label: 'MercadoPago' },
  { value: 'tarjeta', label: 'Tarjeta' },
]

export default function CardsManager() {
  const queryClient = useQueryClient()
  const [editId, setEditId] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [bank, setBank] = useState('')
  const [last4, setLast4] = useState('')
  const [cardType, setCardType] = useState('credito')
  const [accountType, setAccountType] = useState('efectivo')

  const { data: cards = [], isLoading } = useQuery({
    queryKey: ['cards'],
    queryFn: getCards,
  })

  const createMut = useMutation({
    mutationFn: createCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      setEditId(null)
      setName('')
      setBank('')
      setLast4('')
      setCardType('credito')
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      setEditId(null)
      setName('')
      setBank('')
      setLast4('')
      setCardType('credito')
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      setMenuOpen(null)
    },
  })

  const createAccountMut = useMutation({
    mutationFn: (data: { name: string; type: string }) => createAccount(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setEditId(null)
      setName('')
      setAccountType('efectivo')
      setBank('')
      setLast4('')
      setCardType('credito')
    },
  })

  const handleEdit = (card: Card) => {
    setEditId(card.id)
    setName(card.name)
    setBank(card.bank)
    setLast4(card.last4_digits || '')
    setCardType(card.card_type)
    setMenuOpen(null)
  }

  const handleCancel = () => {
    setEditId(null)
    setName('')
    setBank('')
    setLast4('')
    setCardType('credito')
    setAccountType('efectivo')
  }

  const handleAdd = () => {
    setEditId(-1)
    setName('')
    setBank('')
    setLast4('')
    setCardType('credito')
    setAccountType('efectivo')
    setMenuOpen(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    if (accountType === 'tarjeta') {
      const data = {
        name: name.trim(),
        bank: bank.trim(),
        last4_digits: last4.trim() || null,
        card_type: cardType,
      }
      if (editId && editId > 0) {
        updateMut.mutate({ id: editId, data })
      } else {
        createMut.mutate(data)
      }
    } else {
      createAccountMut.mutate({ name: name.trim(), type: accountType })
    }
  }

  if (isLoading) return <div className="p-4 text-sm text-zinc-400">Cargando…</div>

  return (
    <div className="px-4 py-4 space-y-2">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">Tarjetas</h3>
      {cards.map((card) => {
        const isEditing = editId === card.id
        const isMenuOpen = menuOpen === card.id

        return (
          <div key={card.id} className="relative">
            {isEditing ? (
              <form onSubmit={handleSubmit} className="p-3 bg-brand-50 border border-brand-200 rounded-lg space-y-3">
                <div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
                    placeholder="Nombre (ej: Visa Galicia)"
                    autoFocus
                    required
                  />
                </div>
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
                    placeholder="Últimos 4 dígitos"
                    maxLength={4}
                  />
                </div>
                <select
                  value={cardType}
                  onChange={(e) => setCardType(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
                >
                  <option value="credito">Crédito</option>
                  <option value="debito">Débito</option>
                </select>
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
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                  card.card_type === 'credito' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
                }`}>
                  💳
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 truncate">
                    {card.name}
                    {card.bank && <span className="text-zinc-400 font-normal"> — {card.bank}</span>}
                  </div>
                  <div className="text-xs text-zinc-400 flex items-center gap-2">
                    {card.card_type === 'credito' ? 'Crédito' : 'Débito'}
                    {card.last4_digits && (
                      <span className="font-mono text-[10px] bg-zinc-100 px-1.5 py-0.5 rounded">
                        ····{card.last4_digits}
                      </span>
                    )}
                  </div>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen(isMenuOpen ? null : card.id)}
                    className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
                  >
                    ···
                  </button>
                  {isMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(null)} />
                      <div className="absolute right-0 top-8 z-50 w-28 bg-white border border-zinc-200 rounded-lg shadow-lg overflow-hidden">
                        <button
                          onClick={() => handleEdit(card)}
                          className="w-full px-3 py-2 text-xs text-left text-zinc-700 hover:bg-zinc-50 transition-colors"
                        >
                          ✏️ Editar
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`¿Eliminar "${card.name}"?`)) {
                              deleteMut.mutate(card.id)
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
              placeholder={accountType === 'tarjeta' ? 'Nombre (ej: Visa Galicia)' : 'Nombre de la cuenta'}
              autoFocus
              required
            />
          </div>
          <select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          
          {accountType === 'tarjeta' && (
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
                <option value="credito">Crédito</option>
                <option value="debito">Débito</option>
              </select>
            </>
          )}

          {accountType === 'caja_ahorro' && (
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
              disabled={createMut.isPending || createAccountMut.isPending}
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

      {editId === null && (
        <button
          onClick={handleAdd}
          className="w-full py-2.5 border-2 border-dashed border-zinc-200 rounded-lg text-sm text-zinc-500 hover:border-brand-300 hover:text-brand-500 transition-colors"
        >
          + Agregar
        </button>
      )}
    </div>
  )
}
