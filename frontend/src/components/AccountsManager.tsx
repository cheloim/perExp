import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAccounts, createAccount, updateAccount, deleteAccount } from '../api/client'
import type { Account } from '../types'

const ACCOUNT_TYPES = [
  { value: 'efectivo', label: '💵 Efectivo' },
  { value: 'cuenta_corriente', label: '🏦 Cuenta Corriente' },
  { value: 'caja_ahorro', label: '💳 Caja de Ahorro' },
  { value: 'mercadopago', label: '📱 MercadoPago / Billetera' },
  { value: 'otro', label: '💰 Otro' },
]

export default function AccountsManager() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState('efectivo')

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: getAccounts,
  })

  const createMut = useMutation({
    mutationFn: createAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      resetForm()
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; type?: string } }) =>
      updateAccount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      resetForm()
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })

  const resetForm = () => {
    setShowForm(false)
    setEditId(null)
    setName('')
    setType('efectivo')
  }

  const handleEdit = (account: Account) => {
    setEditId(account.id)
    setName(account.name)
    setType(account.type)
    setShowForm(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    if (editId) {
      updateMut.mutate({ id: editId, data: { name: name.trim(), type } })
    } else {
      createMut.mutate({ name: name.trim(), type })
    }
  }

  if (isLoading) return <div className="p-4">Cargando...</div>

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-semibold">Cuentas</h2>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors text-sm font-medium"
            >
              + Nueva Cuenta
            </button>
          )}
        </div>
        <p className="text-sm text-zinc-500">
          Administra tus cuentas para efectivo, transferencias y billeteras digitales.
        </p>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-5 bg-zinc-50 rounded-lg border border-zinc-200">
          <h3 className="text-sm font-semibold text-zinc-900 mb-4">
            {editId ? '✏️ Editar Cuenta' : '➕ Nueva Cuenta'}
          </h3>
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Nombre de la cuenta
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
              placeholder="Ej: Efectivo, MercadoPago, Cuenta Galicia"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">Tipo de cuenta</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
            >
              {ACCOUNT_TYPES.map((t) => (
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
              {editId ? '💾 Guardar Cambios' : '✅ Crear Cuenta'}
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
        {accounts.map((account) => {
          const accountIcon = account.name.toLowerCase().includes('efectivo') ? '💵' :
                            account.name.toLowerCase().includes('mercadopago') ? '📱' :
                            account.type === 'efectivo' ? '💵' :
                            account.type === 'mercadopago' ? '📱' : '🏦'

          return (
            <div
              key={account.id}
              className="flex justify-between items-center p-4 bg-white border border-zinc-200 rounded-lg hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center text-xl">
                  {accountIcon}
                </div>
                <div>
                  <div className="font-semibold text-zinc-900">{account.name}</div>
                  <div className="text-sm text-zinc-500">
                    {ACCOUNT_TYPES.find((t) => t.value === account.type)?.label || account.type}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEdit(account)}
                  className="px-3 py-1.5 text-sm bg-brand-50 text-brand-700 rounded-lg hover:bg-brand-100 transition-colors font-medium"
                >
                  ✏️ Editar
                </button>
                <button
                  onClick={() => {
                    if (confirm(`¿Eliminar cuenta "${account.name}"?\n\nEsta acción no se puede deshacer.`)) {
                      deleteMut.mutate(account.id)
                    }
                  }}
                  className="px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors font-medium"
                  disabled={deleteMut.isPending}
                >
                  🗑️ Eliminar
                </button>
              </div>
            </div>
          )
        })}
        {accounts.length === 0 && !showForm && (
          <div className="text-center py-12 px-6 bg-zinc-50 rounded-lg border-2 border-dashed border-zinc-200">
            <div className="text-4xl mb-3">🏦</div>
            <p className="text-zinc-600 font-medium mb-1">No hay cuentas registradas</p>
            <p className="text-sm text-zinc-500">
              Creá una cuenta para registrar gastos en efectivo o transferencia
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
