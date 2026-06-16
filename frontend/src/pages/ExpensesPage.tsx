import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getExpenses,
  getCategories,
  getDistinctValues,
  createExpense,
  updateExpense,
  deleteExpense,
  bulkUpdateFields,
} from '../api/client'
import type { Expense, ExpenseCreate } from '../types'
import { Select } from '../components/ui/Select'
import { ExpenseModal } from '../components/ExpenseModals'
import { BulkSubmenu } from '../components/ui/BulkSubmenu'
import { AutocompleteInput } from '../components/ui/AutocompleteInput'
import { formatCurrency, toUpperCase, titleCase, getContrastTextColor, SortIcon, categoryGroupOptions, formatDateDMY } from '../utils/format'
import { useExpenseFilters } from '../hooks/useExpenseFilters'
import { ConfirmDialog } from '../components/ConfirmDialog'

type SortField = 'date' | 'description' | 'category' | 'bank' | 'person' | 'amount'
type SortDir = 'asc' | 'desc'

function hasMissingData(exp: Expense): boolean {
  return !exp.category_id || !exp.card || !exp.bank || !exp.person
}

function getMissingDataFields(exp: Expense): string[] {
  const missing: string[] = []
  if (!exp.category_id) missing.push('categoría')
  if (!exp.card) missing.push('tarjeta')
  if (!exp.bank) missing.push('banco')
  if (!exp.person) missing.push('persona')
  return missing
}

export default function ExpensesPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { filters, setFilter, clearFilters, searchParams, setSearchParams } = useExpenseFilters()

  const filterCategory     = filters.categoryId
  const filterUncategorized = filters.uncategorized
  const filterBank          = filters.bank
  const filterPerson        = filters.person
  const filterCard          = filters.card
  const filterDateFrom      = filters.dateFrom
  const filterDateTo        = filters.dateTo
  const filterSearch        = filters.search

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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'date', dir: 'desc' })
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkCategoryId, setBulkCategoryId] = useState<string>('')
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; description: string } | null>(null)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false)
  const [bulkSubmenu, setBulkSubmenu] = useState<'category' | 'bank' | 'card' | 'person' | null>(null)
  const [bulkFieldValue, setBulkFieldValue] = useState('')

  const toggleSelect = (id: number) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const bulkFieldMut = useMutation({
    mutationFn: ({ ids, field, value }: { ids: number[]; field: 'category_id' | 'bank' | 'card' | 'person'; value: string | number | null }) =>
      bulkUpdateFields(ids, { [field]: value }),
    onSuccess: () => {
      invalidate()
      setSelectedIds(new Set())
      setBulkSubmenu(null)
      setBulkMenuOpen(false)
      setBulkFieldValue('')
      setBulkCategoryId('')
    },
    onError: (e: Error) => {
      console.error('Bulk update failed:', e)
      setSaveError('Error al actualizar')
    },
  })

  const handleBulkFieldUpdate = (field: 'category_id' | 'bank' | 'card' | 'person', value: string | number | null) => {
    if (selectedIds.size === 0) return
    bulkFieldMut.mutate({ ids: Array.from(selectedIds), field, value })
  }

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map(id => deleteExpense(id))),
    onSuccess: () => {
      invalidate()
      setSelectedIds(new Set())
    },
  })

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
    `px-4 py-3 text-left cursor-pointer select-none hover:bg-[var(--color-base-alt)] whitespace-nowrap text-xs font-medium text-[var(--text-secondary)] uppercase ${sort.field === field ? 'text-[var(--color-primary)]' : ''}`

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Gastos</h1>
        <div className="flex items-center gap-2">
          {/* Seleccionar */}
          <button
            onClick={() => { setSelectMode(v => !v); setSelectedIds(new Set()) }}
            className={`gnome-btn-secondary-round text-sm ${selectMode ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)] border-transparent' : ''}`}
          >
            {selectMode ? 'Cancelar' : 'Seleccionar'}
          </button>
          {/* Categorías */}
          <button
            onClick={() => navigate('/categories')}
            className="gnome-btn-secondary-round text-sm"
            title="Ir a configuración de categorías"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mr-1">
              <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
              <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
              <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
              <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
            Categorías
          </button>
          <button
            onClick={() => { setEditing(null) }}
            className="gnome-btn-primary-round text-sm"
          >
            <span className="text-base leading-none">+</span>
            <span>Nuevo gasto</span>
          </button>
        </div>
      </div>

      {/* Filter panel */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--text-primary)]">Filtros</span>
          {activeFiltersCount > 0 && (
            <button onClick={clearFilters} className="text-xs text-[var(--text-secondary)] hover:text-[var(--color-primary)] flex items-center gap-1">
              <span className="bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[10px] px-1.5 py-0.5 rounded-full">{activeFiltersCount}</span>
              Limpiar filtros
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {/* Categoría */}
          {(() => {
            const groups = categoryGroupOptions(categories)
            return (
              <Select
                value={filterUncategorized ? '__none__' : (filterCategory ? String(filterCategory) : '')}
                onChange={v => handleCategoryFilter(v)}
                options={[{ value: '__none__', label: 'Sin categoría' }]}
                groups={groups}
                placeholder="Categoría"
              />
            )
          })()}

          {/* Banco */}
          <Select
            value={filterBank ?? ''}
            onChange={v => setFilter('bank', v || undefined)}
            options={(distinctValues?.banks ?? []).map(b => ({ value: b, label: b }))}
            placeholder="Banco"
          />

          {/* Persona */}
          <Select
            value={filterPerson ?? ''}
            onChange={v => setFilter('person', v || undefined)}
            options={(distinctValues?.persons ?? []).map(p => ({ value: p, label: p }))}
            placeholder="Persona"
          />

          {/* Tarjeta */}
          <Select
            value={filterCard ?? ''}
            onChange={v => setFilter('card', v || undefined)}
            options={(distinctValues?.cards ?? []).map(c => ({ value: c, label: c }))}
            placeholder="Tarjeta"
          />

          {/* Desde */}
          <input
            type="date"
            value={filterDateFrom ?? ''}
            onChange={e => setFilter('date_from', e.target.value || undefined)}
            className="text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            placeholder="Desde"
          />

          {/* Hasta */}
          <input
            type="date"
            value={filterDateTo ?? ''}
            onChange={e => setFilter('date_to', e.target.value || undefined)}
            className="text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            placeholder="Hasta"
          />
        </div>

        {/* Search */}
        <input
          type="text"
          value={filterSearch ?? ''}
          onChange={e => setFilter('search', e.target.value || undefined)}
          placeholder="Buscar en descripción..."
          className="w-full text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition placeholder:text-[var(--text-tertiary)]"
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
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-md bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 text-sm">
            <span className="text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--color-primary)]">{expenses.length}</span> gastos
              {filterDateFrom && filterDateTo && (
                <> del <span className="text-[var(--color-primary)] font-medium">{filterDateFrom}</span> al <span className="text-[var(--color-primary)] font-medium">{filterDateTo}</span></>
              )}
              {filterDateFrom && !filterDateTo && <> desde <span className="text-[var(--color-primary)] font-medium">{filterDateFrom}</span></>}
              {!filterDateFrom && filterDateTo && <> hasta <span className="text-[var(--color-primary)] font-medium">{filterDateTo}</span></>}
            </span>
            <span className="text-[var(--text-tertiary)]">·</span>
            <span className="text-[var(--text-secondary)]">Total ARS: <span className="text-[var(--color-primary)] font-semibold">{new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(arsTotal)}</span></span>
            {usdTotal !== 0 && <><span className="text-[var(--text-tertiary)]">·</span><span className="text-[var(--text-secondary)]">Total USD: <span className="text-[var(--color-primary)] font-semibold">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(usdTotal)}</span></span></>}
            <span className="text-[var(--text-tertiary)]">·</span>
            <span className="text-[var(--text-secondary)]">Promedio: <span className="text-[var(--color-primary)] font-semibold">{new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(avg)}</span></span>
          </div>
        )
      })()}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--color-surface)] border-b border-[var(--border-color)]">
              <tr>
                {selectMode && (
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={expenses.length > 0 && selectedIds.size === expenses.length}
                      onChange={e => setSelectedIds(e.target.checked ? new Set(expenses.map(x => x.id)) : new Set())}
                      className="accent-[var(--color-primary)]"
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
                {!selectMode && <th className="px-4 py-3 text-center text-xs font-medium text-[var(--text-secondary)] uppercase">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-color)]">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                    Cargando...
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-secondary)]">
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
                    if (sort.field === 'date') {
                      const parseDate = (s: string) => {
                        const [d, m, y] = s.split('-').map(Number)
                        return new Date(y, m - 1, d).getTime()
                      }
                      const aTime = parseDate(String(aVal))
                      const bTime = parseDate(String(bVal))
                      return sort.dir === 'asc' ? aTime - bTime : bTime - aTime
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
                  .map((exp) => {
                    const missing = hasMissingData(exp)
                    return (
                      <tr
                        key={exp.id}
                        className={`transition-colors ${selectMode ? 'cursor-pointer hover:bg-[var(--color-base-alt)]/50' : 'hover:bg-[var(--color-base-alt)]/30'} ${selectedIds.has(exp.id) ? 'bg-[var(--color-primary)]/10' : ''}`}
                        style={missing ? { borderLeft: '3px solid #f6d32d' } : undefined}
                        onClick={selectMode ? () => toggleSelect(exp.id) : undefined}
                      >
                      {selectMode && (
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(exp.id)}
                            onChange={() => toggleSelect(exp.id)}
                            className="accent-[var(--color-primary)]"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 text-[var(--text-tertiary)] whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setEditing(exp) }}
                          className="text-left hover:text-primary transition"
                        >
                          {formatDateDMY(exp.date)}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {missing && (
                            <span title={`Faltan: ${getMissingDataFields(exp).join(', ')}`} className="text-[#f6d32d]">⚠️</span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setEditing(exp) }}
                            className="text-left hover:text-primary transition"
                          >
                            <span className="text-[var(--text-primary)]">{toUpperCase(exp.description)}</span>
                            {exp.installment_number && exp.installment_total && (
                              <span className="text-xs bg-[var(--color-primary)] text-[var(--color-on-primary)] px-1.5 py-0.5 rounded ml-1">
                                {exp.installment_number}/{exp.installment_total}
                              </span>
                            )}
                          </button>
                        </div>
                        <div className="text-xs text-[var(--text-tertiary)] flex gap-2">
                          {exp.card && <span>{titleCase(exp.card)}</span>}
                          {exp.bank && <span>{titleCase(exp.bank)}</span>}
                          {exp.person && <span>{titleCase(exp.person)}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setEditing(exp) }}
                          className="text-left"
                        >
                          {exp.category_name ? (
                            <span
                              className="px-2 py-1 rounded text-xs font-medium"
                              style={{
                                backgroundColor: (exp.category_color || '#9a9996') + '20',
                                color: getContrastTextColor(exp.category_color || '#9a9996'),
                              }}
                            >
                              {exp.category_name}
                            </span>
                          ) : (
                            <span className="text-[var(--text-tertiary)]">—</span>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setEditing(exp) }}
                          className="text-right hover:text-primary transition"
                        >
                          <span className="text-[var(--text-primary)]">
                            {formatCurrency(exp.amount, exp.currency)}
                          </span>
                        </button>
                      </td>
                      {!selectMode && (
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setEditing(exp) }}
                              className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-primary hover:bg-[var(--color-base-alt)] transition"
                              title="Editar"
                            >
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                              </svg>
                            </button>
                            <button
                              onClick={() => setDeleteConfirm({ id: exp.id, description: exp.description })}
                              className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-danger hover:bg-[var(--color-base-alt)] transition"
                              title="Eliminar"
                            >
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M3 4h8M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M4.5 4v7a1 1 0 001 1h3a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {expenses.length > 0 && (
        <p className="text-xs text-[var(--text-tertiary)] text-right">{expenses.length} gastos</p>
      )}

      {/* Bulk action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-2.5 rounded-full bg-[var(--color-surface)] border border-[var(--border-color)] shadow-gnome-xl">
          <span className="text-sm text-[var(--text-primary)] font-medium">{selectedIds.size} seleccionados</span>
          <div className="relative">
            <button
              onClick={() => setBulkMenuOpen(!bulkMenuOpen)}
              className="gnome-btn-primary-round text-sm"
            >
              Acciones
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`ml-1 transition-transform ${bulkMenuOpen ? 'rotate-180' : ''}`}>
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {bulkMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { setBulkMenuOpen(false); setBulkSubmenu(null) }} />
                <div className="absolute bottom-full left-0 mb-2 z-50 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl shadow-lg overflow-y-auto"
                  style={{
                    maxHeight: '360px',
                    width: bulkSubmenu === 'category' ? '280px' : bulkSubmenu ? '240px' : '220px',
                  }}>
                  <div className="p-3">

                    {bulkSubmenu && (
                      <button
                        onClick={() => setBulkSubmenu(null)}
                        className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] mb-3 transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M7.5 3L4 6L7.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Volver
                      </button>
                    )}

                    {bulkSubmenu === 'category' && (
                      <BulkSubmenu label="Categoría" onClear={() => handleBulkFieldUpdate('category_id', null)}>
                        <Select
                          value={bulkCategoryId}
                          onChange={v => { setBulkCategoryId(v); if (v) handleBulkFieldUpdate('category_id', parseInt(v)); setBulkSubmenu(null); setBulkMenuOpen(false) }}
                          options={[{ value: '', label: 'Sin categoría' }]}
                          groups={categoryGroupOptions(categories)}
                          direction="up"
                        />
                      </BulkSubmenu>
                    )}

                    {bulkSubmenu === 'bank' && (
                      <BulkSubmenu label="Banco">
                        <AutocompleteInput
                          value={bulkFieldValue}
                          onChange={setBulkFieldValue}
                          onSelect={v => { handleBulkFieldUpdate('bank', v); setBulkFieldValue(''); setBulkSubmenu(null); setBulkMenuOpen(false) }}
                          options={distinctValues?.banks ?? []}
                          placeholder="Seleccionar banco..."
                        />
                      </BulkSubmenu>
                    )}

                    {bulkSubmenu === 'card' && (
                      <BulkSubmenu label="Tarjeta">
                        <AutocompleteInput
                          value={bulkFieldValue}
                          onChange={setBulkFieldValue}
                          onSelect={v => { handleBulkFieldUpdate('card', v); setBulkFieldValue(''); setBulkSubmenu(null); setBulkMenuOpen(false) }}
                          options={distinctValues?.cards ?? []}
                          placeholder="Seleccionar tarjeta..."
                        />
                      </BulkSubmenu>
                    )}

                    {bulkSubmenu === 'person' && (
                      <BulkSubmenu label="Titular">
                        <AutocompleteInput
                          value={bulkFieldValue}
                          onChange={setBulkFieldValue}
                          onSelect={v => { handleBulkFieldUpdate('person', v); setBulkFieldValue(''); setBulkSubmenu(null); setBulkMenuOpen(false) }}
                          options={distinctValues?.persons ?? []}
                          placeholder="Seleccionar titular..."
                        />
                      </BulkSubmenu>
                    )}

                    {!bulkSubmenu && (
                      <div className="space-y-1">
                        <button
                          onClick={() => setBulkSubmenu('category')}
                          className="w-full px-3 py-2 text-sm text-left flex items-center justify-between rounded-md hover:bg-[var(--color-base-alt)] transition-colors"
                        >
                          <span>Categoría</span>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[var(--text-tertiary)]">
                            <path d="M4.5 3L8 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => setBulkSubmenu('bank')}
                          className="w-full px-3 py-2 text-sm text-left flex items-center justify-between rounded-md hover:bg-[var(--color-base-alt)] transition-colors"
                        >
                          <span>Banco</span>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[var(--text-tertiary)]">
                            <path d="M4.5 3L8 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => setBulkSubmenu('card')}
                          className="w-full px-3 py-2 text-sm text-left flex items-center justify-between rounded-md hover:bg-[var(--color-base-alt)] transition-colors"
                        >
                          <span>Tarjeta</span>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[var(--text-tertiary)]">
                            <path d="M4.5 3L8 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => setBulkSubmenu('person')}
                          className="w-full px-3 py-2 text-sm text-left flex items-center justify-between rounded-md hover:bg-[var(--color-base-alt)] transition-colors"
                        >
                          <span>Titular</span>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[var(--text-tertiary)]">
                            <path d="M4.5 3L8 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => setBulkDeleteConfirm(true)}
            disabled={bulkDeleteMut.isPending}
            className="gnome-btn-danger-round text-sm"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 4h8M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M4.5 4v7a1 1 0 001 1h3a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Eliminar
          </button>
        </div>
      )}

      {editing !== undefined && (
        <ExpenseModal
          initial={editing}
          onClose={() => { setEditing(undefined); setSaveError(null) }}
          onSave={handleSave}
          saveError={saveError}
        />
      )}

      {deleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          title="Confirmar eliminación"
          message={`¿Estás seguro de eliminar "${deleteConfirm.description}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => {
            deleteMut.mutate(deleteConfirm.id)
            setDeleteConfirm(null)
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {bulkDeleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          title="Eliminar gastos"
          message={`¿Eliminar ${selectedIds.size} gasto${selectedIds.size !== 1 ? 's' : ''}? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => {
            bulkDeleteMut.mutate(Array.from(selectedIds))
            setBulkDeleteConfirm(false)
          }}
          onCancel={() => setBulkDeleteConfirm(false)}
        />
      )}
    </div>
  )
}