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
