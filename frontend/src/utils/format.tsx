import { useState } from 'react'
import { Popover } from '../components/ui/Popover'

export function formatCurrency(amount: number, currency: string = 'ARS') {
  if (currency === 'USD')
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
}

export function formatDate(dateStr: string, format: 'short' | 'long' | 'iso' = 'short'): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr

  switch (format) {
    case 'long':
      return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }).format(date)
    case 'iso':
      return date.toISOString().split('T')[0]
    case 'short':
    default:
      return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(date)
  }
}

export function formatMonthYear(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(date)
}

export function titleCase(str: string): string {
  if (!str) return ''
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

export function toUpperCase(str: string): string {
  if (!str) return ''
  return str.toUpperCase()
}

export function getContrastTextColor(hexColor: string): string {
  if (!hexColor) return '#1c1b1f'
  const hex = hexColor.replace('#', '')
  if (hex.length < 6) return hexColor
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? hexColor : '#ffffff'
}

export function formatDateDMY(dateStr: string, fallback: string = ''): string {
  if (!dateStr) return fallback
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [y, m, d] = dateStr.split('-')
    return `${d}-${m}-${y}`
  }
  return dateStr
}

export function formatDateDMYSlash(dateStr: string, fallback: string = ''): string {
  if (!dateStr) return fallback
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [y, m, d] = dateStr.split('-')
    return `${d}/${m}/${y}`
  }
  return dateStr
}

type SortField = 'date' | 'description' | 'category' | 'bank' | 'person' | 'amount'
type SortDir = 'asc' | 'desc'

export function SortIcon({ field, sort }: { field: SortField; sort: { field: SortField; dir: SortDir } }) {
  if (sort.field !== field) return <span className="ml-1 text-[var(--text-tertiary)]">↕</span>
  return <span className="ml-1 text-[var(--color-primary)]">{sort.dir === 'asc' ? '↑' : '↓'}</span>
}

const MONTHS_ES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export function MonthSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y, m] = value.split('-').map(Number)
  const now = new Date()
  const currentY = now.getFullYear()
  const currentM = now.getMonth() + 1
  const isCurrentMonth = y === currentY && m === currentM
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const shift = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1)
    const newY = d.getFullYear()
    const newM = d.getMonth() + 1
    if (newY > currentY || (newY === currentY && newM > currentM)) return
    if (newY < currentY - 1 || (newY === currentY - 1 && newM < currentM - 5)) return
    onChange(`${newY}-${String(newM).padStart(2, '0')}`)
  }

  const months: { label: string; value: string }[] = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(currentY, currentM - 1 - i, 1)
    const monthVal = d.getMonth() + 1
    const yearVal = d.getFullYear()
    if (yearVal < currentY - 1 || (yearVal === currentY - 1 && monthVal < currentM - 5)) continue
    if (yearVal > currentY || (yearVal === currentY && monthVal > currentM)) continue
    months.unshift({ label: `${MONTHS_ES_SHORT[monthVal - 1]} ${yearVal}`, value: `${yearVal}-${String(monthVal).padStart(2, '0')}` })
  }

  const currentLabel = `${MONTHS_ES_SHORT[m - 1]} ${y}`

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => shift(-1)}
        className="h-8 w-8 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Mes anterior"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <Popover
        isOpen={dropdownOpen}
        onClose={() => setDropdownOpen(false)}
        align="right"
        content={
          <div className="py-1">
            {months.map((month) => (
              <button
                key={month.value}
                type="button"
                onClick={() => { onChange(month.value); setDropdownOpen(false) }}
                className={`w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-[var(--color-base-alt)] rounded-md transition-colors mx-1 ${
                  month.value === value ? 'font-semibold text-[var(--color-primary)]' : 'text-[var(--text-primary)]'
                }`}
              >
                {month.value === value ? '●' : '○'} {month.label}
              </button>
            ))}
          </div>
        }
      >
        <button
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-110 active:scale-95 transition-all"
        >
          <span className="text-sm font-medium">{currentLabel}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </Popover>
      <button
        type="button"
        onClick={() => shift(1)}
        disabled={isCurrentMonth}
        className="h-8 w-8 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Mes siguiente"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  )
}

interface CategoryGroup { label: string; options: { value: string; label: string }[] }

export function categoryGroupOptions(categories: { id: number; name: string; parent_id?: number | null }[]): CategoryGroup[] {
  const parentIds = new Set(categories.filter(c => c.parent_id).map(c => c.parent_id!))
  const parents = categories.filter(c => !c.parent_id && parentIds.has(c.id))
  const orphans = categories.filter(c => !c.parent_id && !parentIds.has(c.id))
  const groups = parents.map(parent => ({
    label: parent.name,
    options: categories.filter(c => c.parent_id === parent.id).map(c => ({ value: String(c.id), label: c.name }))
  }))
  if (orphans.length > 0) {
    groups.push({
      label: '—',
      options: orphans.map(c => ({ value: String(c.id), label: c.name }))
    })
  }
  return groups
}

export function getVariationBadge(variation: number, className: string = '') {
  return (
    <span className={`text-xs mt-1 ${variation > 0 ? 'text-success' : variation < 0 ? 'text-danger' : 'text-tertiary'} ${className}`}>
      {variation > 0 ? '↑' : variation < 0 ? '↓' : '→'} {Math.abs(variation).toFixed(2)}%
    </span>
  )
}