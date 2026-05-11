import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DayPicker } from 'react-day-picker'
import { es } from 'date-fns/locale'
import { getCategories, getAccounts, getCards } from '../api/client'
import type { Expense, ExpenseCreate, Card } from '../types'
import { Select } from './Select'

// Helper function to get today's date in DD-MM-YYYY format
export function todayDDMMYYYY() {
  const now = new Date()
  const d = String(now.getDate()).padStart(2, '0')
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const y = now.getFullYear()
  return `${d}-${m}-${y}`
}

// Empty form template
export const EMPTY_FORM: ExpenseCreate = {
  date: todayDDMMYYYY(),
  description: '',
  amount: 0,
  currency: 'ARS',
  category_id: null,
  card: '',
  bank: '',
  person: '',
  notes: '',
  transaction_id: '',
  installment_number: null,
  installment_total: null,
  installment_group_id: null,
}

// DatePicker component with calendar
export function DatePickerInput({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const getValidDate = (val: string): Date => {
    if (!val || typeof val !== 'string') return new Date()
    const parts = val.split('-')
    if (parts.length !== 3) return new Date()
    const d = parseInt(parts[0])
    const m = parseInt(parts[1])
    const y = parseInt(parts[2])
    if (isNaN(d) || isNaN(m) || isNaN(y)) return new Date()
    if (d < 1 || d > 31 || m < 1 || m > 12 || y < 2000 || y > 2100) return new Date()
    return new Date(y, m - 1, d)
  }

  const selectedDate = getValidDate(value)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        readOnly
        value={value}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition cursor-pointer"
        placeholder="DD-MM-YYYY"
      />
      {isOpen && (
        <div className="absolute z-50 mt-2 p-3 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl shadow-gnome-lg">
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={(d) => {
              if (d) {
                const nd = String(d.getDate()).padStart(2, '0')
                const nm = String(d.getMonth() + 1).padStart(2, '0')
                const ny = d.getFullYear()
                onChange(`${nd}-${nm}-${ny}`)
                setIsOpen(false)
              }
            }}
            locale={es}
            className=""
          />
        </div>
      )}
    </div>
  )
}

// IncomeModal - Dedicated modal for income transactions
export function IncomeModal({
  initial,
  onClose,
  onSave,
  saveError
}: {
  initial?: Expense | null
  onClose: () => void
  onSave: (data: ExpenseCreate) => void
  saveError?: string | null
}) {
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getAccounts })

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Find "Ingresos" parent and its children
  const ingresosParent = categories.find(c => c.name === 'Ingresos' && !c.parent_id)
  const incomeCategories = categories.filter(c => c.parent_id === ingresosParent?.id)

  // Build category options with parent name
  const categoryOptions = incomeCategories.map(c => ({
    value: String(c.id),
    label: ingresosParent ? `${ingresosParent.name} → ${c.name}` : c.name
  }))

  // If editing and current category is not in income categories, add it to options
  if (initial?.category_id) {
    const currentCat = categories.find(c => c.id === initial.category_id)
    if (currentCat && !categoryOptions.some(opt => opt.value === String(currentCat.id))) {
      const parent = currentCat.parent_id
        ? categories.find(c => c.id === currentCat.parent_id)
        : null
      categoryOptions.unshift({
        value: String(currentCat.id),
        label: parent ? `${parent.name} → ${currentCat.name}` : currentCat.name
      })
    }
  }

  const [form, setForm] = useState<ExpenseCreate>(
    initial
      ? {
          date: initial.date,
          description: initial.description,
          amount: Math.abs(initial.amount),
          currency: initial.currency || 'ARS',
          category_id: initial.category_id,
          account_id: initial.account_id,
          notes: initial.notes ?? '',
          card: '',
          bank: '',
          person: '',
        }
      : {
          ...EMPTY_FORM,
          category_id: incomeCategories.find(c => c.name === 'Haberes')?.id ?? null,
        },
  )

  const set = (field: keyof ExpenseCreate, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Fixed backdrop - covers entire viewport */}
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />

      <div className="relative card w-full max-w-lg max-h-[90vh] overflow-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {initial ? 'Editar ingreso' : 'Nuevo ingreso'}
          </h2>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--color-primary)]">
            ✕
          </button>
        </div>

        {/* Income banner */}
        <div className="flex items-center gap-2 bg-success/10 border border-success/30 rounded-lg px-3 py-2 text-xs text-success">
          <span>↓</span>
          <span>El monto se registrará como ingreso (acreditación)</span>
        </div>

        {saveError && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-3 py-2 text-sm">
            {saveError}
          </div>
        )}

        {/* Date */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Fecha</label>
          <DatePickerInput value={form.date} onChange={(v) => set('date', v)} />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Descripción</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            placeholder="Ej: Cobro de sueldo Mayo"
          />
        </div>

        {/* Amount */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Monto</label>
          <input
            type="number"
            value={form.amount || ''}
            onChange={(e) => set('amount', parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            placeholder="0.00"
            step="0.01"
          />
        </div>

        {/* Category selector - ONLY income categories */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Categoría de ingreso</label>
          <Select
            value={String(form.category_id || '')}
            onChange={(v) => set('category_id', Number(v))}
            options={categoryOptions}
            placeholder="Seleccionar categoría"
          />
        </div>

        {/* Account selector (required) - NO "Medio de pago" */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Cuenta destino <span className="text-danger">*</span>
          </label>
          <Select
            value={String(form.account_id || '')}
            onChange={(v) => set('account_id', Number(v))}
            options={accounts.map(a => ({
              value: String(a.id),
              label: a.name
            }))}
            placeholder="Seleccionar cuenta"
          />
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Seleccioná la cuenta donde se acreditará el ingreso
          </p>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Notas (opcional)</label>
          <textarea
            value={form.notes || ''}
            onChange={(e) => set('notes', e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition resize-none"
            rows={3}
            placeholder="Observaciones adicionales..."
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
          >
            Cancelar
          </button>
          <button
            onClick={() => onSave(form)}
            className="flex-1 px-4 py-2 rounded-md bg-[var(--color-success)] text-white text-sm font-medium hover:brightness-110 disabled:opacity-60 transition"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ExpenseModal - Full modal for expense transactions with payment method selector
interface ExpenseModalProps {
  initial?: Expense | null
  isIncome?: boolean
  onClose: () => void
  onSave: (data: ExpenseCreate) => void
  saveError?: string | null
}

export function ExpenseModal({ initial, isIncome = false, onClose, onSave, saveError }: ExpenseModalProps) {
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const { data: cards = [] } = useQuery({ queryKey: ['cards'], queryFn: getCards })

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const isCash = (card: string) => !card || card === 'Efectivo'

  const [payMethod, setPayMethod] = useState<'card' | 'cash'>(
    initial ? (isCash(initial.card ?? '') ? 'cash' : 'card') : isIncome ? 'cash' : 'card'
  )

  const [form, setForm] = useState<ExpenseCreate>(
    initial
      ? {
          date: initial.date,
          description: initial.description,
          amount: Math.abs(initial.amount),
          currency: initial.currency || 'ARS',
          category_id: initial.category_id,
          card: initial.card ?? '',
          bank: initial.bank ?? '',
          person: initial.person ?? '',
          notes: initial.notes ?? '',
          transaction_id: initial.transaction_id ?? '',
          installment_number: initial.installment_number ?? null,
          installment_total: initial.installment_total ?? null,
          installment_group_id: initial.installment_group_id ?? null,
        }
      : EMPTY_FORM,
  )

  // Pre-select Haberes category for new income entries
  useEffect(() => {
    if (!initial && isIncome && categories.length > 0) {
      const haberesCategory = categories.find(c => c.name === 'Haberes')
      if (haberesCategory && !form.category_id) {
        setForm((prev) => ({ ...prev, category_id: haberesCategory.id }))
      }
    }
  }, [initial, isIncome, categories, form.category_id])

  const [cuotasEnabled, setCuotasEnabled] = useState(
    !!(initial?.installment_total && initial.installment_total > 1)
  )

  const toggleCuotas = (enabled: boolean) => {
    setCuotasEnabled(enabled)
    if (enabled) {
      const gid = form.installment_group_id || crypto.randomUUID()
      setForm((prev) => ({ ...prev, installment_number: 1, installment_total: 1, installment_group_id: gid }))
    } else {
      setForm((prev) => ({ ...prev, installment_number: null, installment_total: null, installment_group_id: null }))
    }
  }

  const set = (field: keyof ExpenseCreate, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  const switchPayMethod = (method: 'card' | 'cash') => {
    setPayMethod(method)
    if (method === 'cash') {
      setForm((prev) => ({ ...prev, card: 'Efectivo', bank: '', person: prev.person }))
    } else {
      setForm((prev) => ({ ...prev, card: '', bank: '' }))
    }
  }

  // Cascading selectors: bank → card
  const availableBanks = [...new Set(cards.map(c => c.bank).filter(Boolean))].sort()

  const selectedBank = form.bank ?? ''
  const availableCards = cards.filter(c => !selectedBank || c.bank === selectedBank)

  const handleBankChange = (b: string) => {
    setForm((prev) => ({ ...prev, bank: b, card: '' }))
  }

  const handleCardSelect = (c: Card) => {
    setForm((prev) => ({
      ...prev,
      card: c.name,
      bank: c.bank || '',
    }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative card w-full max-w-lg max-h-[90vh] overflow-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {initial
              ? (isIncome ? 'Editar ingreso' : 'Editar gasto')
              : (isIncome ? 'Nuevo ingreso' : 'Nuevo gasto')}
          </h2>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--color-primary)]">✕</button>
        </div>
        {isIncome && (
          <div className="flex items-center gap-2 bg-success/10 border border-success/30 rounded-lg px-3 py-2 text-xs text-success">
            <span>↓</span>
            <span>El monto se registrará como ingreso (acreditación)</span>
          </div>
        )}

        {saveError && (
          <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger">
            <span className="mt-0.5">✕</span>
            <span>{saveError}</span>
          </div>
        )}

        {/* Payment method toggle */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Medio de pago</label>
          <div className="flex rounded-md border border-[var(--border-color)] overflow-hidden">
            <button
              type="button"
              onClick={() => switchPayMethod('card')}
              className={`flex-1 px-3 py-2 text-sm font-medium transition ${
                payMethod === 'card'
                  ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]'
                  : 'bg-[var(--color-base-container)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]'
              }`}
            >
              💳 Tarjeta
            </button>
            <button
              type="button"
              onClick={() => switchPayMethod('cash')}
              className={`flex-1 px-3 py-2 text-sm font-medium transition ${
                payMethod === 'cash'
                  ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]'
                  : 'bg-[var(--color-base-container)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]'
              }`}
            >
              💵 Efectivo / Transferencia
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-[var(--text-secondary)]">Fecha</label>
          <DatePickerInput value={form.date} onChange={(d) => set('date', d)} />
        </div>

        <div>
          <label className="text-xs font-medium text-[var(--text-secondary)]">Descripción</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Ej: Supermercado Coto"
            className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Monto</label>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => set('amount', parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)]">Moneda</label>
            <Select
              value={form.currency ?? 'ARS'}
              onChange={v => set('currency', v)}
              options={[
                { value: 'ARS', label: 'ARS $' },
                { value: 'USD', label: 'USD $' },
              ]}
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-[var(--text-secondary)]">Categoría</label>
          <Select
            value={form.category_id ? String(form.category_id) : ''}
            onChange={v => set('category_id', v ? parseInt(v) : null)}
            groups={(() => {
              const parentIds = new Set(categories.filter(c => c.parent_id).map(c => c.parent_id!))
              const parents = categories.filter(c => !c.parent_id && parentIds.has(c.id))
              const orphans = categories.filter(c => !c.parent_id && !parentIds.has(c.id))
              return [
                ...parents.map(parent => ({
                  label: parent.name,
                  options: categories.filter(c => c.parent_id === parent.id).map(c => ({ value: String(c.id), label: c.name }))
                })),
                ...(orphans.length > 0 ? [{ label: '—', options: orphans.map(c => ({ value: String(c.id), label: c.name })) }] : [])
              ]
            })()}
            placeholder="Sin categoría"
          />
        </div>

        {/* Cascading: Banco → Tarjeta */}
        <div className={`space-y-3 transition-opacity ${payMethod === 'cash' ? 'opacity-40 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)]">Banco</label>
              <Select
                value={form.bank ?? ''}
                onChange={v => handleBankChange(v)}
                options={availableBanks.map(b => ({ value: b, label: b }))}
                placeholder="— Banco —"
                disabled={payMethod === 'cash'}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)]">Tarjeta</label>
              <Select
                value={form.card ?? ''}
                onChange={v => {
                  const selected = availableCards.find(c => c.name === v)
                  if (selected) handleCardSelect(selected)
                  else set('card', v)
                }}
                options={availableCards.map(c => ({ value: c.name, label: c.name }))}
                placeholder="— Tarjeta —"
                disabled={payMethod === 'cash'}
              />
            </div>
          </div>
        </div>

        {payMethod === 'card' && !isIncome && (
          <div className="border border-[var(--border-color)] rounded-md p-3 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={cuotasEnabled}
                onChange={(e) => toggleCuotas(e.target.checked)}
                className="accent-[var(--color-primary)]"
              />
              <span className="text-sm font-medium text-[var(--text-secondary)]">Compra en cuotas</span>
            </label>
            {cuotasEnabled && (
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">Cuota N°</label>
                  <input
                    type="number"
                    min={1}
                    value={form.installment_number ?? 1}
                    onChange={(e) => set('installment_number', parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition text-center"
                  />
                </div>
                <span className="text-[var(--text-tertiary)] mt-4">de</span>
                <div className="flex-1">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">Total cuotas</label>
                  <input
                    type="number"
                    min={1}
                    value={form.installment_total ?? 1}
                    onChange={(e) => set('installment_total', parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition text-center"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-[var(--text-secondary)]">Notas</label>
          <textarea
            value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition resize-none"
            rows={2}
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
          >
            Cancelar
          </button>
          <button
            onClick={() => onSave({ ...form, amount: isIncome ? -Math.abs(form.amount) : Math.abs(form.amount) })}
            className="flex-1 px-4 py-2 rounded-md bg-[var(--color-primary)] text-white text-sm font-medium hover:brightness-110 disabled:opacity-60 transition"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
