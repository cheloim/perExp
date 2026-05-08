import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCards, createCard, updateCard, deleteCard, createAccount, getCardSummary } from '../api/client'
import { useQuery as useCardDataQuery } from '@tanstack/react-query'
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
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'card' | 'account'; id: number; name: string } | null>(null)
  const [name, setName] = useState('')
  const [bank, setBank] = useState('')
  const [cardType, setCardType] = useState('credito')
  const [accountType, setAccountType] = useState('efectivo')

  const { data: cards = [], isLoading } = useQuery({
    queryKey: ['cards'],
    queryFn: getCards,
  })

  // Card data from expenses (for future extension - show spending by card)
  useCardDataQuery({
    queryKey: ['card-summary'],
    queryFn: getCardSummary,
    enabled: false, // Disabled for now - can be enabled for future features
  })

  const createMut = useMutation({
    mutationFn: createCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      setEditId(null)
      setName('')
      setBank('')
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
      setCardType('credito')
    },
  })

  const handleEdit = (card: Card) => {
    setEditId(card.id)
    setName(card.name)
    setBank(card.bank || '')
    setCardType(card.card_type)
    setMenuOpen(null)
  }

  const handleCancel = () => {
    setEditId(null)
    setName('')
    setBank('')
    setCardType('credito')
    setAccountType('efectivo')
  }

  const handleAdd = () => {
    setEditId(-1)
    setName('')
    setBank('')
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

  if (isLoading) return <div className="p-4 text-sm text-tertiary">Cargando…</div>

  return (
    <div className="px-4 py-2 space-y-2">
      <h3 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Tarjetas</h3>
      
      {cards.map((card) => {
        const isEditing = editId === card.id
        const isMenuOpen = menuOpen === card.id

        return (
          <div key={card.id} className="relative">
            {isEditing ? (
              <form onSubmit={handleSubmit} className="p-4 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">Nombre</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                    placeholder="Ej: Visa Galicia"
                    autoFocus
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">Banco</label>
                  <input
                    type="text"
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                    placeholder="Ej: Galicia"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">Tipo</label>
                  <select
                    value={cardType}
                    onChange={(e) => setCardType(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  >
                    <option value="credito">Crédito</option>
                    <option value="debito">Débito</option>
                  </select>
                </div>
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
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold badge-primary">
                  💳
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-primary truncate">
                    {card.name}
                    {card.bank && <span className="text-tertiary font-normal"> — {card.bank}</span>}
                  </div>
                  <div className="text-xs text-secondary capitalize">
                    {card.card_type}
                  </div>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen(isMenuOpen ? null : card.id)}
                    className="w-7 h-7 flex items-center justify-center rounded text-tertiary hover:text-primary hover:bg-base-alt transition-colors"
                  >
                    ···
                  </button>
                  {isMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(null)} />
                      <div className="absolute right-0 top-8 z-50 w-28 bg-surface border border-border-color rounded-lg shadow-lg overflow-hidden">
                        <button
                          onClick={() => handleEdit(card)}
                          className="w-full px-3 py-2 text-xs text-left text-primary hover:bg-base-alt transition-colors"
                        >
                          ✏️ Editar
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'card', id: card.id, name: card.name })}
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

      {editId === -1 && (
        <form onSubmit={handleSubmit} className="p-4 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Tipo de cuenta</label>
            <select
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {accountType === 'tarjeta' && (
            <div className="space-y-3 pt-2 border-t border-[var(--border-color)]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Crédito / Débito</label>
                <select
                  value={cardType}
                  onChange={(e) => setCardType(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                >
                  <option value="credito">Crédito</option>
                  <option value="debito">Débito</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Banco</label>
                <input
                  type="text"
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  placeholder="Ej: Galicia"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Nombre</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              placeholder={accountType === 'tarjeta' ? 'Ej: Visa Galicia' : 'Ej: Mi Cuenta'}
              autoFocus
              required
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={createMut.isPending || createAccountMut.isPending}
              className="flex-1 px-4 py-2 rounded-md bg-[var(--color-primary)] text-[var(--color-on-primary)] text-sm font-medium hover:brightness-110 disabled:opacity-60 transition"
            >
              {createMut.isPending || createAccountMut.isPending ? 'Creando...' : 'Crear'}
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
      )}

      {editId === null && (
        <button
          onClick={handleAdd}
          className="w-full py-2.5 border-2 border-dashed border-border-color rounded-lg text-sm text-secondary hover:border-primary hover:text-primary transition-colors"
        >
          + Agregar
        </button>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-primary mb-2">Confirmar eliminación</h3>
            <p className="text-sm text-secondary mb-6">
              ¿Estás seguro de eliminar <span className="font-medium text-primary">"{deleteConfirm.name}"</span>? Esta acción no se puede deshacer.
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
                className="flex-1 px-4 py-2 rounded-md bg-[var(--red-3,#e01b24)] text-white text-sm font-medium hover:brightness-110 disabled:opacity-60 transition"
              >
                {deleteMut.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}