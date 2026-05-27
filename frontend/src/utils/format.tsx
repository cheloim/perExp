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

const MONTHS_ES_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

type SortField = 'date' | 'description' | 'category' | 'bank' | 'person' | 'amount'
type SortDir = 'asc' | 'desc'

export function SortIcon({ field, sort }: { field: SortField; sort: { field: SortField; dir: SortDir } }) {
  if (sort.field !== field) return <span className="ml-1 text-[var(--text-tertiary)]">↕</span>
  return <span className="ml-1 text-[var(--color-primary)]">{sort.dir === 'asc' ? '↑' : '↓'}</span>
}

export function MonthSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y, m] = value.split('-').map(Number)
  const now = new Date()
  const currentY = now.getFullYear()
  const currentM = now.getMonth() + 1
  const isCurrentMonth = y === currentY && m === currentM
  const sixMonthsAgo = new Date(currentY, currentM - 1 - 6, 1)
  const isSixMonthsAgo = y < sixMonthsAgo.getFullYear() || (y === sixMonthsAgo.getFullYear() && m <= sixMonthsAgo.getMonth() + 1)
  const shift = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1)
    const newY = d.getFullYear()
    const newM = d.getMonth() + 1
    if (newY > currentY || (newY === currentY && newM > currentM)) return
    if (newY < currentY - 1 || (newY === currentY - 1 && newM < currentM - 5)) return
    onChange(`${newY}-${String(newM).padStart(2, '0')}`)
  }
  return (
    <div className="flex items-center gap-0.5 bg-base-alt border border-border-color rounded-lg px-1 py-1">
      <button
        onClick={() => shift(-1)}
        disabled={isSixMonthsAgo}
        className="px-2 py-0.5 text-tertiary hover:text-primary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >◀</button>
      <span className="text-primary text-sm font-medium px-3 min-w-[140px] text-center select-none">
        {MONTHS_ES_LONG[m - 1]} {y}
      </span>
      <button
        onClick={() => shift(1)}
        disabled={isCurrentMonth}
        className="px-2 py-0.5 text-tertiary hover:text-primary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >▶</button>
    </div>
  )
}

export type { SortField, SortDir }

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
