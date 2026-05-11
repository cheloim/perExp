export function formatCurrency(amount: number, currency: string = 'ARS') {
  if (currency === 'USD')
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount)
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount)
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
