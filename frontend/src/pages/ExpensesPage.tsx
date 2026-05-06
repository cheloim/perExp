import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { DayPicker } from 'react-day-picker'
import { es } from 'date-fns/locale'
import {
  getExpenses,
  getCategories,
  getDistinctValues,
  getCardSummary,
  createExpense,
  updateExpense,
  deleteExpense,
  bulkUpdateCategory,
} from '../api/client'
import type { Expense, ExpenseCreate, CardSummary } from '../types'

function formatCurrency(amount: number, currency: string = 'ARS') {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount)
  }
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(amount)
}

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [y, m, d] = dateStr.split('-')
    return `${d}-${m}-${y}`
  }
  return dateStr
}

type SortField = 'date' | 'description' | 'category' | 'bank' | 'person' | 'amount'
type SortDir = 'asc' | 'desc'

function SortIcon({ field, sort }: { field: SortField; sort: { field: SortField; dir: SortDir } }) {
  if (sort.field !== field) return <span className="ml-1 text-zinc-600">↕</span>
  return <span className="ml-1 text-brand-400">{sort.dir === 'asc' ? '↑' : '↓'}</span>
}

export default function ExpensesPage() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  // URL-synced filters
  const filterCategory     = searchParams.get('category_id') ? parseInt(searchParams.get('category_id')!) : undefined
  const filterUncategorized = searchParams.get('uncategorized') === '1'
  const filterBank          = searchParams.get('bank')     || undefined
  const filterPerson        = searchParams.get('person')   || undefined
  const filterCard          = searchParams.get('card')     || undefined
  const filterDateFrom      = searchParams.get('date_from') || undefined
  const filterDateTo        = searchParams.get('date_to')   || undefined
  const filterSearch        = searchParams.get('search')   || undefined

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value); else next.delete(key)
    setSearchParams(next)
  }
  const clearFilters = () => setSearchParams(new URLSearchParams())

  const handleCategoryFilter = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === '__none__') {
      next.set('uncategorized', '1')
      next.delete('category_id')
    } else if (value) {
      next.set('category_id', value)
      next.delete('uncategorized')
    } else {
      next.delete('category_id')
      next.delete('uncategorized')
    }
    setSearchParams(next)
  }

  const activeFiltersCount = [filterCategory, filterUncategorized || undefined, filterBank, filterPerson, filterCard, filterDateFrom, filterDateTo, filterSearch].filter(Boolean).length

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['expenses'] })

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', filterCategory, filterUncategorized, filterBank, filterPerson, filterCard, filterDateFrom, filterDateTo, filterSearch],
    queryFn: () => getExpenses({
      category_id: filterCategory,
      uncategorized: filterUncategorized || undefined,
      bank: filterBank,
      person: filterPerson,
      card: filterCard,
      date_from: filterDateFrom,
      date_to: filterDateTo,
      search: filterSearch,
      limit: 500,
    }),
  })

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const { data: distinctValues } = useQuery({ queryKey: ['distinct-values'], queryFn: getDistinctValues, staleTime: 60_000 })

  const [editing, setEditing] = useState<Expense | null | undefined>(undefined)
  const [editingIsIncome, setEditingIsIncome] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'date', dir: 'desc' })
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkCategoryId, setBulkCategoryId] = useState<string>('')

  const toggleSelect = (id: number) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const bulkMut = useMutation({
    mutationFn: ({ ids, catId }: { ids: number[]; catId: number | null }) =>
      bulkUpdateCategory(ids, catId),
    onSuccess: () => {
      invalidate()
      setSelectedIds(new Set())
      setBulkCategoryId('')
    },
  })

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map(id => deleteExpense(id))),
    onSuccess: () => {
      invalidate()
      setSelectedIds(new Set())
    },
  })

  const handleBulkApply = () => {
    if (selectedIds.size === 0) return
    const catId = bulkCategoryId ? parseInt(bulkCategoryId) : null
    bulkMut.mutate({ ids: Array.from(selectedIds), catId })
  }

  const createMut = useMutation({
    mutationFn: createExpense,
    onSuccess: () => {
      invalidate()
      setEditing(undefined)
      setSaveError(null)
    },
    onError: (e: Error) => setSaveError(e.message),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ExpenseCreate> }) =>
      updateExpense(id, data),
    onSuccess: () => {
      invalidate()
      setEditing(undefined)
      setSaveError(null)
    },
    onError: (e: Error) => setSaveError(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: deleteExpense,
    onSuccess: invalidate,
  })

  const handleSave = (data: ExpenseCreate) => {
    setSaveError(null)
    if (editing && editing.id) {
      updateMut.mutate({ id: editing.id, data })
    } else {
      createMut.mutate(data)
    }
  }

  const thClass = (field: SortField) =>
    `px-4 py-3 text-left cursor-pointer select-none hover:bg-zinc-100/80 whitespace-nowrap ${sort.field === field ? 'text-brand-400' : ''}`

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-900">Gastos</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSelectMode(v => !v); setSelectedIds(new Set()) }}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-all ${
              selectMode
                ? 'bg-brand-500/20 border-brand-500/40 text-brand-400'
                : 'border-zinc-300 text-zinc-400 hover:text-zinc-700 hover:border-zinc-600'
            }`}
          >
            {selectMode ? 'Cancelar' : 'Seleccionar'}
          </button>
          <button
            onClick={() => { setEditingIsIncome(true); setEditing(null) }}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-all"
          >
            <span className="text-base leading-none">↓</span>
            Ingreso
          </button>
          <button
            onClick={() => { setEditingIsIncome(false); setEditing(null) }}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <span className="text-lg leading-none">+</span>
            Nuevo gasto
          </button>
        </div>
      </div>

      {/* Filter panel */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-900">Filtros</span>
          {activeFiltersCount > 0 && (
            <button onClick={clearFilters} className="text-xs text-zinc-400 hover:text-zinc-900 flex items-center gap-1">
              <span className="bg-brand-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">{activeFiltersCount}</span>
              Limpiar filtros
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {/* Categoría */}
          {(() => {
            const parentIds = new Set(categories.filter(c => c.parent_id).map(c => c.parent_id!))
            const parents = categories.filter(c => !c.parent_id && parentIds.has(c.id))
            const orphans = categories.filter(c => !c.parent_id && !parentIds.has(c.id))
            return (
              <select
                value={filterUncategorized ? '__none__' : (filterCategory ?? '')}
                onChange={e => handleCategoryFilter(e.target.value)}
                className="bg-zinc-100 border border-zinc-300 text-sm text-zinc-900 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500"
              >
                <option value="">Categoría</option>
                <option value="__none__">Sin categoría</option>
                {parents.map(parent => (
                  <optgroup key={parent.id} label={parent.name}>
                    {categories.filter(c => c.parent_id === parent.id).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                ))}
                {orphans.length > 0 && (
                  <optgroup label="—">
                    {orphans.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                )}
              </select>
            )
          })()}

          {/* Banco */}
          <select
            value={filterBank ?? ''}
            onChange={e => setFilter('bank', e.target.value || undefined)}
            className="bg-zinc-100 border border-zinc-300 text-sm text-zinc-900 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500"
          >
            <option value="">Banco</option>
            {(distinctValues?.banks ?? []).map(b => <option key={b} value={b}>{b}</option>)}
          </select>

          {/* Persona */}
          <select
            value={filterPerson ?? ''}
            onChange={e => setFilter('person', e.target.value || undefined)}
            className="bg-zinc-100 border border-zinc-300 text-sm text-zinc-900 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500"
          >
            <option value="">Persona</option>
            {(distinctValues?.persons ?? []).map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          {/* Tarjeta */}
          <select
            value={filterCard ?? ''}
            onChange={e => setFilter('card', e.target.value || undefined)}
            className="bg-zinc-100 border border-zinc-300 text-sm text-zinc-900 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500"
          >
            <option value="">Tarjeta</option>
            {(distinctValues?.cards ?? []).map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Desde */}
          <input
            type="date"
            value={filterDateFrom ?? ''}
            onChange={e => setFilter('date_from', e.target.value || undefined)}
            className="bg-zinc-100 border border-zinc-300 text-sm text-zinc-900 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500"
            placeholder="Desde"
          />

          {/* Hasta */}
          <input
            type="date"
            value={filterDateTo ?? ''}
            onChange={e => setFilter('date_to', e.target.value || undefined)}
            className="bg-zinc-100 border border-zinc-300 text-sm text-zinc-900 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500"
            placeholder="Hasta"
          />
        </div>

        {/* Search */}
        <input
          type="text"
          value={filterSearch ?? ''}
          onChange={e => setFilter('search', e.target.value || undefined)}
          placeholder="Buscar en descripción..."
          className="w-full bg-zinc-100 border border-zinc-300 text-sm text-zinc-900 rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand-500 placeholder:text-zinc-500"
        />
      </div>

      {/* Date-range summary banner */}
      {(filterDateFrom || filterDateTo) && expenses.length > 0 && (() => {
        const arsExpenses = expenses.filter(e => (e.currency || 'ARS') === 'ARS')
        const usdExpenses = expenses.filter(e => e.currency === 'USD')
        const arsTotal = arsExpenses.reduce((s, e) => s + e.amount, 0)
        const usdTotal = usdExpenses.reduce((s, e) => s + e.amount, 0)
        const avg = arsExpenses.length > 0 ? arsTotal / arsExpenses.length : 0
        return (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-brand-500/10 border border-brand-500/20 text-sm">
            <span className="text-zinc-600">
              <span className="font-semibold text-zinc-900">{expenses.length}</span> gastos
              {filterDateFrom && filterDateTo && (
                <> del <span className="text-zinc-900 font-medium">{filterDateFrom}</span> al <span className="text-zinc-900 font-medium">{filterDateTo}</span></>
              )}
              {filterDateFrom && !filterDateTo && <> desde <span className="text-zinc-900 font-medium">{filterDateFrom}</span></>}
              {!filterDateFrom && filterDateTo && <> hasta <span className="text-zinc-900 font-medium">{filterDateTo}</span></>}
            </span>
            <span className="text-zinc-500">·</span>
            <span className="text-zinc-600">Total ARS: <span className="text-zinc-900 font-semibold">{new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(arsTotal)}</span></span>
            {usdTotal !== 0 && <><span className="text-zinc-500">·</span><span className="text-zinc-600">Total USD: <span className="text-zinc-900 font-semibold">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(usdTotal)}</span></span></>}
            <span className="text-zinc-500">·</span>
            <span className="text-zinc-600">Promedio: <span className="text-zinc-900 font-semibold">{new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(avg)}</span></span>
          </div>
        )
      })()}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-white border-b border-zinc-200">
              <tr>
                {selectMode && (
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={expenses.length > 0 && selectedIds.size === expenses.length}
                      onChange={e => setSelectedIds(e.target.checked ? new Set(expenses.map(x => x.id)) : new Set())}
                      className="accent-brand-500"
                    />
                  </th>
                )}
                <th className={thClass('date')} onClick={() => setSort({ field: 'date', dir: sort.dir === 'asc' && sort.field === 'date' ? 'desc' : 'asc' })}>
                  Fecha <SortIcon field="date" sort={sort} />
                </th>
                <th className={thClass('description')} onClick={() => setSort({ field: 'description', dir: sort.dir === 'asc' && sort.field === 'description' ? 'desc' : 'asc' })}>
                  Descripción <SortIcon field="description" sort={sort} />
                </th>
                <th className={thClass('category')}>Categoría</th>
                <th className={thClass('amount')} onClick={() => setSort({ field: 'amount', dir: sort.dir === 'asc' && sort.field === 'amount' ? 'desc' : 'asc' })}>
                  Monto <SortIcon field="amount" sort={sort} />
                </th>
                {!selectMode && <th className="px-4 py-3 text-center">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    Cargando...
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    No hay gastos registrados.
                  </td>
                </tr>
              ) : (
                expenses
                  .sort((a, b) => {
                    const aVal = a[sort.field as keyof Expense]
                    const bVal = b[sort.field as keyof Expense]
                    if (aVal == null) return 1
                    if (bVal == null) return -1
                    if (sort.field === 'amount') {
                      return sort.dir === 'asc'
                        ? (aVal as number) - (bVal as number)
                        : (bVal as number) - (aVal as number)
                    }
                    let aStr = String(aVal)
                    let bStr = String(bVal)
                    if (sort.field === 'description') {
                      const pad = (n: number | null | undefined) => String(n ?? 0).padStart(4, '0')
                      aStr += `\x00${pad(a.installment_number)}`
                      bStr += `\x00${pad(b.installment_number)}`
                    }
                    const cmp = aStr.localeCompare(bStr)
                    return sort.dir === 'asc' ? cmp : -cmp
                  })
                  .map((exp) => (
                    <tr
                      key={exp.id}
                      className={`transition-colors ${selectMode ? 'cursor-pointer hover:bg-zinc-100/40' : 'hover:bg-zinc-100/30'} ${selectedIds.has(exp.id) ? 'bg-brand-500/10' : ''}`}
                      onClick={selectMode ? () => toggleSelect(exp.id) : undefined}
                    >
                      {selectMode && (
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(exp.id)}
                            onChange={() => toggleSelect(exp.id)}
                            className="accent-brand-500"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                        {formatDate(exp.date)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-900">{exp.description}</span>
                          {exp.installment_number && exp.installment_total && (
                            <span className="text-xs bg-brand-900 text-brand-300 px-1.5 py-0.5 rounded">
                              {exp.installment_number}/{exp.installment_total}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 flex gap-2">
                          {exp.card && <span>{exp.card}</span>}
                          {exp.bank && <span>{exp.bank}</span>}
                          {exp.person && <span>{exp.person}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {exp.category_name ? (
                          <span
                            className="px-2 py-1 rounded text-xs font-medium"
                            style={{
                              backgroundColor: (exp.category_color || '#6b7280') + '20',
                              color: exp.category_color || '#6b7280',
                            }}
                          >
                            {exp.category_name}
                          </span>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={exp.amount < 0 ? 'text-green-400' : 'text-zinc-900'}>
                          {formatCurrency(exp.amount, exp.currency)}
                        </span>
                      </td>
                      {!selectMode && (
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => { setEditingIsIncome(exp.amount < 0); setEditing(exp) }}
                            className="text-brand-400 hover:text-brand-300 mr-3"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('¿Eliminar este gasto?')) deleteMut.mutate(exp.id)
                            }}
                            className="text-red-400 hover:text-red-600"
                          >
                            🗑️
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {expenses.length > 0 && (
        <p className="text-xs text-zinc-500 text-right">{expenses.length} gastos</p>
      )}

      {/* Bulk action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl bg-white border border-zinc-300 shadow-2xl">
          <span className="text-sm text-zinc-900 font-medium">{selectedIds.size} seleccionados</span>
          <span className="text-zinc-600">|</span>
          <select
            value={bulkCategoryId}
            onChange={e => setBulkCategoryId(e.target.value)}
            className="bg-zinc-100 border border-zinc-300 text-sm text-zinc-900 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500"
          >
            <option value="">Sin categoría</option>
            {(() => {
              const parentIds = new Set(categories.filter(c => c.parent_id).map(c => c.parent_id!))
              const parents = categories.filter(c => !c.parent_id && parentIds.has(c.id))
              const orphans = categories.filter(c => !c.parent_id && !parentIds.has(c.id))
              return <>
                {parents.map(parent => (
                  <optgroup key={parent.id} label={parent.name}>
                    {categories.filter(c => c.parent_id === parent.id).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                ))}
                {orphans.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </>
            })()}
          </select>
          <button
            onClick={handleBulkApply}
            disabled={bulkMut.isPending || bulkDeleteMut.isPending}
            className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50"
          >
            {bulkMut.isPending ? 'Aplicando...' : 'Aplicar'}
          </button>
          <span className="text-zinc-600">|</span>
          <button
            onClick={() => {
              if (confirm(`¿Eliminar ${selectedIds.size} gasto${selectedIds.size !== 1 ? 's' : ''}?`)) {
                bulkDeleteMut.mutate(Array.from(selectedIds))
              }
            }}
            disabled={bulkMut.isPending || bulkDeleteMut.isPending}
            className="text-sm px-4 py-1.5 rounded-lg bg-red-600/20 border border-red-600/40 text-red-400 hover:bg-red-600/30 disabled:opacity-50 transition-colors"
          >
            {bulkDeleteMut.isPending ? 'Eliminando...' : 'Eliminar'}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-zinc-400 hover:text-zinc-700 text-sm"
          >
            Limpiar
          </button>
        </div>
      )}

      {editing !== undefined && (
        <ExpenseModal
          initial={editing}
          isIncome={editingIsIncome}
          onClose={() => { setEditing(undefined); setSaveError(null) }}
          onSave={handleSave}
          saveError={saveError}
        />
      )}
    </div>
  )
}

function todayDDMMYYYY() {
  const now = new Date()
  const d = String(now.getDate()).padStart(2, '0')
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const y = now.getFullYear()
  return `${d}-${m}-${y}`
}

const EMPTY_FORM: ExpenseCreate = {
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
  card_last4: '',
  installment_number: null,
  installment_total: null,
  installment_group_id: null,
}

interface ExpenseModalProps {
  initial?: Expense | null
  isIncome?: boolean
  onClose: () => void
  onSave: (data: ExpenseCreate) => void
  saveError?: string | null
}

function DatePickerInput({ value, onChange }: { value: string; onChange: (d: string) => void }) {
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
        className="w-full input cursor-pointer"
        placeholder="DD-MM-YYYY"
      />
      {isOpen && (
        <div className="absolute z-50 mt-2 p-3 bg-white border border-zinc-300 rounded-xl shadow-xl">
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

function ExpenseModal({ initial, isIncome = false, onClose, onSave, saveError }: ExpenseModalProps) {
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const { data: cardSummary = [] } = useQuery({ queryKey: ['card-summary'], queryFn: getCardSummary, staleTime: 60_000 })

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
          card_last4: initial.card_last4 ?? '',
          installment_number: initial.installment_number ?? null,
          installment_total: initial.installment_total ?? null,
          installment_group_id: initial.installment_group_id ?? null,
        }
      : EMPTY_FORM,
  )

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
      setForm((prev) => ({ ...prev, card: 'Efectivo', bank: '', person: prev.person, card_last4: '' }))
    } else {
      setForm((prev) => ({ ...prev, card: '', bank: '', card_last4: '' }))
    }
  }

  // Cascading selectors driven by CardSummary
  const persons = [...new Set(cardSummary.map(c => c.holder))].filter(Boolean).sort()

  const selectedPerson = form.person ?? ''
  const cardsForPerson = cardSummary.filter(c => !selectedPerson || c.holder === selectedPerson)
  const availableBanks = [...new Set(cardsForPerson.map(c => c.bank))].filter(Boolean).sort()

  const selectedBank = form.bank ?? ''
  const availableCards = cardsForPerson.filter(c => !selectedBank || c.bank === selectedBank)

  const cardLabel = (c: CardSummary) =>
    c.last4 ? `${c.card_name} *${c.last4}` : c.card_name

  const handlePersonChange = (p: string) => {
    setForm((prev) => ({ ...prev, person: p, bank: '', card: '', card_last4: '' }))
  }

  const handleBankChange = (b: string) => {
    setForm((prev) => ({ ...prev, bank: b, card: '', card_last4: '' }))
  }

  const handleCardSelect = (c: CardSummary) => {
    setForm((prev) => ({
      ...prev,
      card: c.card_name,
      bank: c.bank,
      person: c.holder,
      card_last4: c.last4 ?? '',
    }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative card w-full max-w-lg max-h-[90vh] overflow-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">
            {initial
              ? (isIncome ? 'Editar ingreso' : 'Editar gasto')
              : (isIncome ? 'Nuevo ingreso' : 'Nuevo gasto')}
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">✕</button>
        </div>
        {isIncome && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700">
            <span>↓</span>
            <span>El monto se registrará como ingreso (acreditación)</span>
          </div>
        )}

        {saveError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            <span className="mt-0.5">✕</span>
            <span>{saveError}</span>
          </div>
        )}

        {/* Payment method toggle */}
        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">Medio de pago</label>
          <div className="flex rounded-xl overflow-hidden border border-zinc-300">
            <button
              type="button"
              onClick={() => switchPayMethod('card')}
              className={`flex-1 py-2 text-sm font-medium transition-colors border-r border-zinc-300 ${
                payMethod === 'card' ? 'bg-brand-500/20 text-brand-400' : 'text-zinc-400 hover:text-zinc-700'
              }`}
            >
              💳 Tarjeta
            </button>
            <button
              type="button"
              onClick={() => switchPayMethod('cash')}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                payMethod === 'cash' ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-400 hover:text-zinc-700'
              }`}
            >
              💵 Efectivo / Transferencia
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-1">Fecha</label>
          <DatePickerInput value={form.date} onChange={(d) => set('date', d)} />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-1">Descripción</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Ej: Supermercado Coto"
            className="w-full input"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-zinc-600 mb-1">Monto</label>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => set('amount', parseFloat(e.target.value) || 0)}
              className="w-full input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">Moneda</label>
            <select value={form.currency ?? 'ARS'} onChange={(e) => set('currency', e.target.value)} className="w-full input">
              <option value="ARS">ARS $</option>
              <option value="USD">USD $</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-1">Categoría</label>
          <select
            value={form.category_id ?? ''}
            onChange={(e) => set('category_id', e.target.value ? parseInt(e.target.value) : null)}
            className="w-full input"
          >
            <option value="">Sin categoría</option>
            {(() => {
              const parentIds = new Set(categories.filter(c => c.parent_id).map(c => c.parent_id!))
              const parents = categories.filter(c => !c.parent_id && parentIds.has(c.id))
              const orphans = categories.filter(c => !c.parent_id && !parentIds.has(c.id))
              return <>
                {parents.map(parent => (
                  <optgroup key={parent.id} label={parent.name}>
                    {categories.filter(c => c.parent_id === parent.id).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                ))}
                {orphans.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </>
            })()}
          </select>
        </div>

        {/* Cascading: Titular → Banco → Tarjeta */}
        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-1">Titular</label>
          <select value={form.person ?? ''} onChange={(e) => handlePersonChange(e.target.value)} className="w-full input">
            <option value="">— Seleccionar titular —</option>
            {persons.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className={`space-y-3 transition-opacity ${payMethod === 'cash' ? 'opacity-40 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-sm font-medium mb-1 ${!selectedPerson ? 'text-zinc-500' : 'text-zinc-600'}`}>
                Banco {!selectedPerson && <span className="text-xs">(elegí titular primero)</span>}
              </label>
              <select
                value={form.bank ?? ''}
                onChange={(e) => handleBankChange(e.target.value)}
                disabled={payMethod === 'cash' || !selectedPerson}
                className="w-full input disabled:opacity-50"
              >
                <option value="">— Banco —</option>
                {availableBanks.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1 ${!selectedBank ? 'text-zinc-500' : 'text-zinc-600'}`}>
                Tarjeta {!selectedBank && payMethod === 'card' && <span className="text-xs">(elegí banco primero)</span>}
              </label>
              <select
                value={form.card_last4 ? `${form.card}|${form.card_last4}` : (form.card ?? '')}
                onChange={(e) => {
                  const selected = availableCards.find(c =>
                    (c.last4 ? `${c.card_name}|${c.last4}` : c.card_name) === e.target.value
                  )
                  if (selected) handleCardSelect(selected)
                  else set('card', e.target.value)
                }}
                disabled={payMethod === 'cash' || !selectedBank}
                className="w-full input disabled:opacity-50"
              >
                <option value="">— Tarjeta —</option>
                {availableCards.map(c => {
                  const val = c.last4 ? `${c.card_name}|${c.last4}` : c.card_name
                  return <option key={val} value={val}>{cardLabel(c)}</option>
                })}
              </select>
            </div>
          </div>
          {/* Last 4 digits — auto-filled from card selection, editable manually */}
          <div className={payMethod === 'cash' ? 'hidden' : ''}>
            <label className="block text-sm font-medium text-zinc-600 mb-1">
              Últimos 4 dígitos de la tarjeta
            </label>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 font-mono text-sm tracking-widest">•••• •••• ••••</span>
              <input
                type="text"
                maxLength={4}
                pattern="\d{4}"
                value={form.card_last4 ?? ''}
                onChange={(e) => set('card_last4', e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="0000"
                className="w-20 input font-mono tracking-widest text-center"
              />
            </div>
          </div>
        </div>

        {payMethod === 'card' && !isIncome && (
          <div className="border border-zinc-200 rounded-xl p-3 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={cuotasEnabled}
                onChange={(e) => toggleCuotas(e.target.checked)}
                className="rounded border-zinc-300 text-brand-600"
              />
              <span className="text-sm font-medium text-zinc-700">Compra en cuotas</span>
            </label>
            {cuotasEnabled && (
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-zinc-500 mb-1">Cuota N°</label>
                  <input
                    type="number"
                    min={1}
                    value={form.installment_number ?? 1}
                    onChange={(e) => set('installment_number', parseInt(e.target.value) || 1)}
                    className="w-full input text-center"
                  />
                </div>
                <span className="text-zinc-400 mt-4">de</span>
                <div className="flex-1">
                  <label className="block text-xs text-zinc-500 mb-1">Total cuotas</label>
                  <input
                    type="number"
                    min={1}
                    value={form.installment_total ?? 1}
                    onChange={(e) => set('installment_total', parseInt(e.target.value) || 1)}
                    className="w-full input text-center"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-1">Notas</label>
          <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} className="w-full input" rows={2} />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={() => onSave({ ...form, amount: isIncome ? -Math.abs(form.amount) : Math.abs(form.amount) })}
            className={`flex-1 ${isIncome ? 'bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-4 rounded-xl transition-colors' : 'btn-primary'}`}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}