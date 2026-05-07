import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCards, createCard, updateCard, deleteCard } from '../api/client'
import type { Card } from '../types'

const CARD_TYPES = [
  { value: 'credito', label: '💳 Crédito' },
  { value: 'debito', label: '💳 Débito' },
]

export default function CardsManager() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [bank, setBank] = useState('')
  const [last4, setLast4] = useState('')
  const [cardType, setCardType] = useState('credito')

  const { data: cards = [], isLoading } = useQuery({
    queryKey: ['cards'],
    queryFn: getCards,
  })

  const createMut = useMutation({
    mutationFn: createCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      resetForm()
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      resetForm()
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
    },
  })

  const resetForm = () => {
    setShowForm(false)
    setEditId(null)
    setName('')
    setBank('')
    setLast4('')
    setCardType('credito')
  }

  const handleEdit = (card: Card) => {
    setEditId(card.id)
    setName(card.name)
    setBank(card.bank)
    setLast4(card.last4_digits || '')
    setCardType(card.card_type)
    setShowForm(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    const data = {
      name: name.trim(),
      bank: bank.trim(),
      last4_digits: last4.trim() || null,
      card_type: cardType,
    }

    if (editId) {
      updateMut.mutate({ id: editId, data })
    } else {
      createMut.mutate(data)
    }
  }

  if (isLoading) return <div className="p-4">Cargando...</div>

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-semibold">Tarjetas</h2>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors text-sm font-medium"
            >
              + Nueva Tarjeta
            </button>
          )}
        </div>
        <p className="text-sm text-zinc-500">
          Administra tus tarjetas de crédito y débito.
        </p>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-5 bg-zinc-50 rounded-lg border border-zinc-200">
          <h3 className="text-sm font-semibold text-zinc-900 mb-4">
            {editId ? '✏️ Editar Tarjeta' : '➕ Nueva Tarjeta'}
          </h3>
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Nombre de la tarjeta
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
              placeholder="Ej: Visa, Mastercard, Amex"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">Banco emisor</label>
            <input
              type="text"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
              placeholder="Ej: Galicia, HSBC, Santander"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Últimos 4 dígitos (opcional)
            </label>
            <input
              type="text"
              value={last4}
              onChange={(e) => setLast4(e.target.value.slice(0, 4))}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition font-mono"
              placeholder="1234"
              maxLength={4}
              pattern="[0-9]*"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">Tipo de tarjeta</label>
            <select
              value={cardType}
              onChange={(e) => setCardType(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
            >
              {CARD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors font-medium text-sm"
              disabled={createMut.isPending || updateMut.isPending}
            >
              {editId ? '💾 Guardar Cambios' : '✅ Crear Tarjeta'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 bg-white border border-zinc-300 text-zinc-700 rounded-lg hover:bg-zinc-50 transition-colors font-medium text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {cards.map((card) => (
          <div
            key={card.id}
            className="flex justify-between items-center p-4 bg-white border border-zinc-200 rounded-lg hover:shadow-sm transition-shadow"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-xl">
                💳
              </div>
              <div>
                <div className="font-semibold text-zinc-900">
                  {card.name}
                  {card.bank && <span className="text-zinc-500 font-normal"> - {card.bank}</span>}
                </div>
                <div className="text-sm text-zinc-500 flex items-center gap-2">
                  {CARD_TYPES.find((t) => t.value === card.card_type)?.label || card.card_type}
                  {card.last4_digits && (
                    <span className="font-mono text-xs bg-zinc-100 px-2 py-0.5 rounded">
                      ****{card.last4_digits}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleEdit(card)}
                className="px-3 py-1.5 text-sm bg-brand-50 text-brand-700 rounded-lg hover:bg-brand-100 transition-colors font-medium"
              >
                ✏️ Editar
              </button>
              <button
                onClick={() => {
                  if (confirm(`¿Eliminar tarjeta "${card.name}"?\n\nEsta acción no se puede deshacer.`)) {
                    deleteMut.mutate(card.id)
                  }
                }}
                className="px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors font-medium"
                disabled={deleteMut.isPending}
              >
                🗑️ Eliminar
              </button>
            </div>
          </div>
        ))}
        {cards.length === 0 && !showForm && (
          <div className="text-center py-12 px-6 bg-zinc-50 rounded-lg border-2 border-dashed border-zinc-200">
            <div className="text-4xl mb-3">💳</div>
            <p className="text-zinc-600 font-medium mb-1">No hay tarjetas registradas</p>
            <p className="text-sm text-zinc-500">
              Creá una tarjeta para registrar tus gastos con tarjeta de crédito o débito
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
