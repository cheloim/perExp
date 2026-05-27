import { useSearchParams } from 'react-router-dom'

export interface ExpenseFilters {
  categoryId: number | undefined
  uncategorized: boolean
  bank: string | undefined
  person: string | undefined
  card: string | undefined
  dateFrom: string | undefined
  dateTo: string | undefined
  search: string | undefined
}

export function useExpenseFilters() {
  const [searchParams, setSearchParams] = useSearchParams()

  const filters: ExpenseFilters = {
    categoryId: searchParams.get('category_id') ? parseInt(searchParams.get('category_id')!) : undefined,
    uncategorized: searchParams.get('uncategorized') === '1',
    bank: searchParams.get('bank') || undefined,
    person: searchParams.get('person') || undefined,
    card: searchParams.get('card') || undefined,
    dateFrom: searchParams.get('date_from') || undefined,
    dateTo: searchParams.get('date_to') || undefined,
    search: searchParams.get('search') || undefined,
  }

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value); else next.delete(key)
    setSearchParams(next)
  }

  const clearFilters = () => setSearchParams(new URLSearchParams())

  return { filters, setFilter, clearFilters, searchParams, setSearchParams }
}