import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { DayPicker } from 'react-day-picker'
import { es } from 'date-fns/locale'
import {
  PieChart, Pie, Cell,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  getExpenses,
  getCardSummary,
  getDashboard,
  getCategories,
  createExpense,
  updateExpense,
  deleteExpense,
  getDistinctValues,
  bulkUpdateCategory,
  getCards,
  getAccounts,
  createCard,
  updateCard,
  deleteCard,
  createAccount,
  updateAccount,
  deleteAccount
} from '../api/client'
import type { CategorySummary, Expense, ExpenseCreate, Category, CardSummary } from '../types'

type GroupBy = 'month' | 'year'
type SortField = 'date' | 'description' | 'category' | 'bank' | 'person' | 'amount'
type SortDir = 'asc' | 'desc'

function formatCurrency(amount: number, currency: string = 'ARS') {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount)
  }
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount)
}

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [y, m, d] = dateStr.split('-')
    return `${d}-${m}-${y}`
  }
  return dateStr
}

function groupSmallSlices(data: CategorySummary[], thresholdPct = 3) {
  if (data.length === 0) return data
  const total = data.reduce((s, d) => s + Math.abs(d.total), 0)
  const big: CategorySummary[] = []
  const small: CategorySummary[] = []
  for (const d of data) {
    const pct = total > 0 ? (Math.abs(d.total) / total) * 100 : 0
    if (pct >= thresholdPct) big.push(d)
    else small.push(d)
  }
  if (small.length === 0) return big
  const othersTotal = small.reduce((s, d) => s + d.total, 0)
  return [
    ...big,
    {
      category_id: null,
      category_name: `Otros (${small.length})`,
      category_color: '#94a3b8',
      total: othersTotal,
      count: small.reduce((s, d) => s + d.count, 0),
    },
  ]
}

function PieLabel({ cx, cy, midAngle, outerRadius, percent, category_name }: any) {
  if (percent < 0.05) return null
  const RADIAN = Math.PI / 180
  const r = outerRadius + 18
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fill="#374151">
      {category_name} {(percent * 100).toFixed(0)}%
    </text>
  )
}

function TrendIcon({ current, previous }: { current: number; previous: number }) {
  if (!previous || previous === 0) return null
  const pct = ((current - previous) / Math.abs(previous)) * 100
  if (Math.abs(pct) < 5) return <span className="text-zinc-500 text-xs">→</span>
  if (pct > 0) return <span className="text-red-500 text-xs font-bold">▲{pct.toFixed(0)}%</span>
  return <span className="text-green-500 text-xs font-bold">▼{Math.abs(pct).toFixed(0)}%</span>
}

function SortIcon({ field, sort }: { field: SortField; sort: { field: SortField; dir: SortDir } }) {
  if (sort.field !== field) return <span className="ml-1 text-zinc-600">↕</span>
  return <span className="ml-1 text-brand-400">{sort.dir === 'asc' ? '↑' : '↓'}</span>
}

function CategoryDrilldown({ category, month, onClose }: { category: CategorySummary; month: string; onClose: () => void }) {
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', 'drill', category.category_id, month],
    queryFn: () => getExpenses({ category_id: category.category_id ?? undefined, month: month || undefined, limit: 100 }),
    enabled: category.category_id != null,
  })

  return (
    <div className="border border-zinc-200 rounded-xl bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200 bg-zinc-100/80">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: category.category_color || '#94a3b8' }} />
        <span className="font-semibold text-zinc-900 text-sm">{category.category_name}</span>
        <span className="text-xs text-zinc-500 ml-1">{category.count} gastos</span>
        <span className="ml-auto text-sm font-semibold text-zinc-900">{formatCurrency(category.total)}</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-400 text-lg leading-none ml-2">×</button>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-zinc-200">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
          </div>
        ) : category.category_id == null ? (
          <p className="text-center text-zinc-500 py-8 text-sm">Esta categoría agrupa varios items pequeños.</p>
        ) : expenses.length === 0 ? (
          <p className="text-center text-zinc-500 py-8 text-sm">Sin gastos en este período</p>
        ) : (
          expenses.map((exp) => (
            <div key={exp.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-zinc-100">
              <div>
                <p className="text-sm text-zinc-900">{exp.description}</p>
                <p className="text-xs text-zinc-500">{formatDate(exp.date)}{exp.person ? ` · ${exp.person}` : ''}</p>
              </div>
              <span className={`text-sm font-semibold ${exp.amount < 0 ? 'text-green-400' : 'text-zinc-900'}`}>
                {formatCurrency(exp.amount, exp.currency)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

type CardNetwork = 'visa' | 'mastercard' | 'amex' | 'unknown'

function detectNetwork(cardName: string): CardNetwork {
  const s = cardName.toLowerCase()
  if (s.includes('visa')) return 'visa'
  if (s.includes('mastercard') || s.includes('master')) return 'mastercard'
  if (s.includes('amex') || s.includes('american')) return 'amex'
  return 'unknown'
}

function VisaLogo() {
  return (
    <svg width="52" height="18" viewBox="0 0 52 18" fill="none">
      <text x="1" y="15" fontFamily="Arial Black, Arial, sans-serif" fontSize="17" fontWeight="900" fontStyle="italic" fill="white" letterSpacing="2">VISA</text>
    </svg>
  )
}

function MastercardLogo() {
  return (
    <svg width="42" height="28" viewBox="0 0 42 28" fill="none">
      <circle cx="15" cy="14" r="13" fill="#EB001B"/>
      <circle cx="27" cy="14" r="13" fill="#F79E1B" fillOpacity="0.92"/>
    </svg>
  )
}

function AmexLogo() {
  return (
    <svg width="46" height="22" viewBox="0 0 46 22" fill="none">
      <rect width="46" height="22" rx="3" fill="rgba(255,255,255,0.25)"/>
      <text x="23" y="15.5" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="10" fontWeight="bold" fill="white" letterSpacing="1.5">AMEX</text>
    </svg>
  )
}

function CardNetworkLogo({ network }: { network: CardNetwork }) {
  if (network === 'visa') return <VisaLogo />
  if (network === 'mastercard') return <MastercardLogo />
  if (network === 'amex') return <AmexLogo />
  return null
}


function CreditCardViz({ holder, cardName, bank, monthly, active, onClick, index, filterMonth, last4 }: {
  holder: string; cardName: string; bank: string; monthly?: { month: string; total: number }[];
  active: boolean; onClick: () => void; index: number; filterMonth: string; last4?: string;
}) {
  const network = detectNetwork(cardName)
  const exactEntry = monthly?.find(m => m.month === filterMonth)
  const monthTotal = exactEntry?.total ?? 0
  const [dispY, dispM] = filterMonth.split('-')
  const monthLabel = `${MONTHS_ES[parseInt(dispM) - 1]} ${dispY}`
  const gradientColors = [
    'from-indigo-600 to-purple-700',
    'from-emerald-600 to-teal-700',
    'from-orange-600 to-red-700',
    'from-pink-600 to-rose-700',
    'from-cyan-600 to-blue-700',
    'from-amber-600 to-yellow-700',
  ]
  const color = gradientColors[index % gradientColors.length]
  const hasDigits = !!last4 && /^\d{4}$/.test(last4)

  return (
    <div
      onClick={onClick}
      className={`relative rounded-2xl p-5 bg-gradient-to-br ${color} cursor-pointer transition-all duration-200 hover:scale-[1.01] shadow-xl flex-shrink-0 w-72 ${active ? 'ring-2 ring-white/70 scale-[1.01]' : 'opacity-90 hover:opacity-100'}`}
    >
      {/* Top row: left = bank + card type, right = logo + holder + number */}
      <div className="flex justify-between items-start gap-3">
        {/* Left */}
        <div className="min-w-0">
          <p className="text-zinc-900/55 text-[11px] font-semibold tracking-widest uppercase">{bank || 'Banco'}</p>
          <p className="text-zinc-900 text-sm font-bold tracking-wide mt-0.5 truncate">{cardName}</p>
        </div>
        {/* Right: logo + holder + number stacked */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          <CardNetworkLogo network={network} />
          <p className="text-zinc-900 text-xs font-semibold uppercase tracking-wide text-right leading-tight">
            {holder.split(',').reverse().join(' ').trim()}
          </p>
          <p className="text-zinc-900/50 text-xs tracking-widest font-mono">
            {hasDigits ? `•••• ${last4}` : '💳 Tarjeta'}
          </p>
        </div>
      </div>

      {/* Month total */}
      <div className="mt-4 pt-3 border-t border-white/15 flex items-end justify-between">
        <div>
          <p className="text-zinc-900/50 text-[11px]">{monthLabel}</p>
          <p className="text-zinc-900 font-bold text-xl leading-tight mt-0.5">{formatCurrency(monthTotal)}</p>
        </div>
        {/* Sparkline */}
        {monthly && monthly.length > 0 && (
          <div className="h-8 flex items-end gap-0.5 opacity-50 w-20">
            {(() => {
              const slice = monthly.slice(-6)
              const maxVal = Math.max(...slice.map(m => Math.abs(m.total)), 1)
              return slice.map((m, i) => (
                <div key={i} className="flex-1 bg-white/70 rounded-t-sm" style={{ height: `${(Math.abs(m.total) / maxVal) * 100}%` }} />
              ))
            })()}
          </div>
        )}
      </div>
    </div>
  )
}

const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function HScrollCards({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  const scrollInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const check = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', check); ro.disconnect() }
  }, [check])

  const startScroll = (dir: -1 | 1) => {
    if (scrollInterval.current) return
    scrollInterval.current = setInterval(() => {
      ref.current?.scrollBy({ left: dir * 6 })
    }, 16)
  }

  const stopScroll = () => {
    if (scrollInterval.current) { clearInterval(scrollInterval.current); scrollInterval.current = null }
  }

  return (
    <div className="relative">
      {/* Left arrow */}
      {canLeft && (
        <div
          onMouseEnter={() => startScroll(-1)}
          onMouseLeave={stopScroll}
          className="absolute left-0 top-0 bottom-0 z-10 flex items-center w-12 cursor-pointer"
          style={{ background: 'linear-gradient(to right, rgba(24,24,27,0.85) 0%, transparent 100%)' }}
        >
          <span className="ml-1 text-zinc-600 text-lg select-none">‹</span>
        </div>
      )}
      {/* Right arrow */}
      {canRight && (
        <div
          onMouseEnter={() => startScroll(1)}
          onMouseLeave={stopScroll}
          className="absolute right-0 top-0 bottom-0 z-10 flex items-center justify-end w-12 cursor-pointer"
          style={{ background: 'linear-gradient(to left, rgba(24,24,27,0.85) 0%, transparent 100%)' }}
        >
          <span className="mr-1 text-zinc-600 text-lg select-none">›</span>
        </div>
      )}
      <div
        ref={ref}
        className="flex gap-3 overflow-x-auto pb-1 scrollbar-none"
      >
        {children}
      </div>
    </div>
  )
}

export default function AccountsPage() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [month, _setMonth] = useState(currentMonth)
  const [groupBy, _setGroupBy] = useState<GroupBy>('month')
  const [activeCat, setActiveCat] = useState<CategorySummary | null>(null)
  const [activeCard, setActiveCard] = useState<string | null>(null)
  const [bankFilter, setBankFilter] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  // URL-synced filters
  const filterCategory = searchParams.get('category_id') ? parseInt(searchParams.get('category_id')!) : undefined
  const filterUncategorized = searchParams.get('uncategorized') === '1'
  const filterBank = searchParams.get('bank') || undefined
  const filterPerson = searchParams.get('person') || undefined
  const filterCard = searchParams.get('card') || undefined
  const filterDateFrom = searchParams.get('date_from') || undefined
  const filterDateTo = searchParams.get('date_to') || undefined
  const filterSearch = searchParams.get('search') || undefined

  // UI states
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkCategoryId, setBulkCategoryId] = useState<string>('')
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'date', dir: 'desc' })

  // Modal states
  const [editing, setEditing] = useState<Expense | null | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | null>(null)

  

  // Helper functions
  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value); else next.delete(key)
    setSearchParams(next)
  }

  const clearFilters = () => {
    setSearchParams(new URLSearchParams())
  }

  const activeFiltersCount = [
    filterCategory, filterUncategorized || undefined, filterBank,
    filterPerson, filterCard, filterDateFrom, filterDateTo, filterSearch
  ].filter(Boolean).length

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const { data: cardData = [] } = useQuery({
    queryKey: ['card-summary'],
    queryFn: getCardSummary,
  })

  const { data: cardsTable = [] } = useQuery({
    queryKey: ['cards'],
    queryFn: getCards,
  })

  const { data: accountsTable = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: getAccounts,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories
  })

  const { data: distinctValues } = useQuery({
    queryKey: ['distinct-values'],
    queryFn: getDistinctValues,
    staleTime: 60_000
  })

  const { data: cardSummary = [] } = useQuery({
    queryKey: ['card-summary'],
    queryFn: getCardSummary
  })

  const activeCardLast4 = activeCard
    ? (cardData.find(c => `${c.holder}|${c.card_name}` === activeCard)?.last4 || null)
    : null

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', month, groupBy, activeCardLast4, bankFilter],
    queryFn: () => getDashboard({
      month: month || undefined,
      group_by: groupBy,
      card_last4: activeCardLast4 || undefined,
      bank: bankFilter || undefined,
    }),
    placeholderData: (prev) => prev,
  })

  // Full expenses list with all filters
  const { data: expenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ['expenses', month, filterCategory, filterUncategorized, filterBank,
               filterPerson, filterCard, filterDateFrom, filterDateTo, filterSearch,
               activeCardLast4, bankFilter],
    queryFn: () => getExpenses({
      month: month || undefined,
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

  // Mutations
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['expenses'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['card-summary'] })
    queryClient.invalidateQueries({ queryKey: ['card-category-breakdown'] })
  }

  const createMut = useMutation({
    mutationFn: createExpense,
    onSuccess: () => { invalidate(); setEditing(undefined); setSaveError(null) },
    onError: (e: any) => setSaveError(e?.response?.data?.detail || e.message),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ExpenseCreate> }) =>
      updateExpense(id, data),
    onSuccess: () => { invalidate(); setEditing(undefined); setSaveError(null) },
    onError: (e: any) => setSaveError(e?.response?.data?.detail || e.message),
  })

  const deleteMut = useMutation({
    mutationFn: deleteExpense,
    onSuccess: invalidate,
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

  const createCardMut = useMutation({
    mutationFn: (data: { name: string; bank: string; last4_digits?: string; card_type: string }) => createCard(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['cards'] }) },
  })

  const updateCardMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; bank?: string; last4_digits?: string; card_type?: string } }) => updateCard(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['cards'] }) },
  })

  const deleteCardMut = useMutation({
    mutationFn: (id: number) => deleteCard(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['cards'] }) },
  })

  const createAccountMut = useMutation({
    mutationFn: (data: { name: string; type: string }) => createAccount(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['accounts'] }) },
  })

  const updateAccountMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; type?: string } }) => updateAccount(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['accounts'] }) },
  })

  const deleteAccountMut = useMutation({
    mutationFn: (id: number) => deleteAccount(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['accounts'] }) },
  })

  const handleAddAccount = () => {
    const type = prompt('Tipo de cuenta:\n1. Efectivo\n2. Cta. Corriente\n3. Caja de Ahorro\n4. MercadoPago\n5. Tarjeta\n\nIngresa el número:')
    if (!type) return

    if (type === '5') {
      const name = prompt('Nombre de la tarjeta (ej: Visa Galicia):')
      if (!name) return
      const bank = prompt('Banco (ej: Galicia):') || ''
      const last4 = prompt('Últimos 4 dígitos (opcional):') || undefined
      createCardMut.mutate({ name, bank, last4_digits: last4 || undefined, card_type: 'credito' })
    } else {
      const typeMap: Record<string, string> = { '1': 'efectivo', '2': 'cuenta_corriente', '3': 'caja_ahorro', '4': 'mercadopago' }
      const accountType = typeMap[type]
      if (!accountType) { alert('Tipo inválido'); return }
      const name = prompt('Nombre de la cuenta:')
      if (!name) return
      createAccountMut.mutate({ name, type: accountType })
    }
  }

  const handleEditCard = (card: { id: number; name: string; bank: string; last4_digits: string | null; card_type: string }) => {
    const name = prompt('Nombre de la tarjeta:', card.name)
    if (name === null) return
    const bank = prompt('Banco:', card.bank) || ''
    const last4 = prompt('Últimos 4 dígitos:', card.last4_digits || '') || ''
    const cardType = prompt('Tipo (credito/debito):', card.card_type) || 'credito'
    updateCardMut.mutate({ id: card.id, data: { name, bank, last4_digits: last4 || undefined, card_type: cardType } })
  }

  const handleEditAccount = (account: { id: number; name: string; type: string }) => {
    const name = prompt('Nombre de la cuenta:', account.name)
    if (name === null) return
    const type = prompt('Tipo (efectivo/cuenta_corriente/caja_ahorro/mercadopago):', account.type) || 'efectivo'
    updateAccountMut.mutate({ id: account.id, data: { name, type } })
  }

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    )
  }

  if (!data) {
    return <div className="text-center text-zinc-500 py-20">Error loading dashboard</div>
  }

  const hasTrend = data.by_category.some(c => c.previous_total !== undefined)

  // Roll up subcategories to their parent for pie chart display
  const rolledUp: Record<string, CategorySummary> = {}
  for (const cat of data.by_category) {
    const key = cat.parent_name ?? cat.category_name
    const color = cat.parent_color ?? cat.category_color
    if (rolledUp[key]) {
      rolledUp[key] = { ...rolledUp[key], total: rolledUp[key].total + cat.total, count: rolledUp[key].count + cat.count }
    } else {
      rolledUp[key] = {
        ...cat,
        category_name: key,
        category_color: color,
        category_id: cat.parent_id ?? cat.category_id,
      }
    }
  }
  const pieData = groupSmallSlices(Object.values(rolledUp)).map((c) => ({
    category_name: c.category_name,
    category_color: c.category_color,
    total: Math.abs(c.total),
  }))



  const handlePieClick = (entry: any) => {
    // entry.category_name may be a parent name — find first matching leaf or the rolled-up entry
    if (activeCat?.category_name === entry.category_name) {
      setActiveCat(null)
    } else {
      // Try exact match first, then parent name match
      const found = data.by_category.find(c => c.category_name === entry.category_name)
        ?? data.by_category.find(c => c.parent_name === entry.category_name)
      if (found) setActiveCat({ ...found, category_name: entry.category_name })
    }
  }

  return (
    <div className="space-y-6">
      <div className={`grid grid-cols-1 gap-4 ${data.by_currency.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {data.by_currency.length <= 1 ? (
          <div className="card p-5">
            <p className="text-sm text-zinc-400">Total Gastos</p>
            <p className="text-3xl font-bold text-zinc-900 mt-1">
              {formatCurrency(data.total_amount, data.by_currency[0]?.currency ?? 'ARS')}
            </p>
          </div>
        ) : (
          data.by_currency.map((bc) => (
            <div key={bc.currency} className="card p-5">
              <p className="text-sm text-zinc-400">
                Total Gastos{' '}
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${bc.currency === 'USD' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-brand-300'}`}>
                  {bc.currency}
                </span>
              </p>
              <p className="text-3xl font-bold text-zinc-900 mt-1">{formatCurrency(bc.total, bc.currency)}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{bc.count} transacciones</p>
            </div>
          ))
        )}
        <div className="card p-5">
          <p className="text-sm text-zinc-400">Transacciones</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{data.total_expenses}</p>
        </div>
      </div>

      {/* Cards panel — horizontal scroll row */}
      {cardData.length > 0 && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Tarjetas</h2>
            <div className="flex items-center gap-2">
              {(() => {
                const banks = [...new Set(cardData.map(c => c.bank))].sort()
                if (banks.length <= 1) return null
                return (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setBankFilter(null)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-all ${!bankFilter ? 'bg-zinc-600 border-zinc-500 text-zinc-900' : 'border-zinc-300 text-zinc-400 hover:text-zinc-600'}`}
                    >
                      Todos
                    </button>
                    {banks.map(b => (
                      <button
                        key={b}
                        onClick={() => setBankFilter(bankFilter === b ? null : b)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-all ${bankFilter === b ? 'bg-zinc-600 border-zinc-500 text-zinc-900' : 'border-zinc-300 text-zinc-400 hover:text-zinc-600'}`}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                )
              })()}
              {activeCard && (
                <button onClick={() => setActiveCard(null)} className="text-xs text-zinc-500 hover:text-zinc-400">
                  Limpiar
                </button>
              )}
            </div>
          </div>
          <HScrollCards>
            {cardData
              .filter(card => !bankFilter || card.bank === bankFilter)
              .map((card, idx) => {
                const ckey = `${card.holder}|${card.card_name}`
                return (
                  <CreditCardViz
                    key={ckey}
                    index={idx}
                    holder={card.holder}
                    cardName={card.card_name}
                    bank={card.bank}
                    monthly={card.monthly}
                    active={activeCard === ckey}
                    onClick={() => setActiveCard(activeCard === ckey ? null : ckey)}
                    filterMonth={month}
                    last4={card.last4}
                  />
                )
              })}
          </HScrollCards>
        </div>
      )}

      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-zinc-900">Gastos por Categoría</h2>
                {activeCat && (
                  <button onClick={() => setActiveCat(null)} className="text-xs text-zinc-500 hover:text-zinc-400">
                    Cerrar detalle
                  </button>
                )}
              </div>

              {data.by_category.length === 0 ? (
                <p className="text-zinc-500 text-sm text-center py-12">Sin datos</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={320}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="total"
                        nameKey="category_name"
                        cx="50%"
                        cy="50%"
                        outerRadius={110}
                        innerRadius={40}
                        paddingAngle={2}
                        onClick={(entry) => handlePieClick(entry)}
                        style={{ cursor: 'pointer' }}
                        labelLine={false}
                        label={PieLabel}
                      >
                        {pieData.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={entry.category_color || '#94a3b8'}
                            opacity={activeCat && activeCat.category_name !== entry.category_name ? 0.4 : 1}
                            stroke={activeCat?.category_name === entry.category_name ? '#1e293b' : 'none'}
                            strokeWidth={2}
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#f4f4f5' }} itemStyle={{ color: '#f4f4f5' }} formatter={(v: number, name: string) => [formatCurrency(v), name]} />
                    </PieChart>
                  </ResponsiveContainer>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {pieData.map((entry, i) => {
                      const full = data.by_category.find((c) => c.category_name === entry.category_name)
                      return (
                        <button
                          key={i}
                          onClick={() => handlePieClick(entry)}
                          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-all ${
                            activeCat?.category_name === entry.category_name
                              ? 'border-gray-400 bg-gray-100 font-semibold'
                              : 'border-zinc-200 hover:border-gray-300 hover:bg-zinc-100'
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.category_color || '#94a3b8' }} />
                          {entry.category_name}
                          {hasTrend && full?.previous_total !== undefined && full.previous_total > 0 && (
                            <TrendIcon current={full.total} previous={full.previous_total} />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              {activeCat && (
                <CategoryDrilldown category={activeCat} month={month} onClose={() => setActiveCat(null)} />
              )}
            </div>

            <div className="card p-5">
              <h2 className="text-base font-semibold text-zinc-900 mb-4">Evolución por Tarjeta</h2>
              {(() => {
                const filteredCards = cardData.filter(card => !bankFilter || card.bank === bankFilter)
                if (filteredCards.length === 0) {
                  return <p className="text-zinc-500 text-sm text-center py-12">Sin datos</p>
                }

                const now = new Date()
                const currentYear = now.getFullYear()
                const currentMonthNum = now.getMonth() + 1
                const monthsRange: string[] = []
                for (let i = -3; i <= 0; i++) {
                  const d = new Date(currentYear, currentMonthNum - 1 + i, 1)
                  monthsRange.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
                }

                const chartData = monthsRange.map(m => {
                  const entry: Record<string, number | string> = { month: m }
                  let monthTotal = 0
                  filteredCards.forEach(card => {
                    const cardKey = card.card_name + (card.last4 ? ` (••${card.last4})` : '')
                    const monthData = card.monthly?.find((x: { month: string }) => x.month === m)
                    const value = monthData?.total || 0
                    entry[cardKey] = value
                    monthTotal += value
                  })
                  entry['total'] = monthTotal
                  return entry
                })

                const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16']

                return (
                  <div className="bg-zinc-50 rounded-lg p-4">
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d8" vertical={false} />
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 10, fill: '#71717a' }}
                          tickFormatter={(v) => {
                            const [y, m] = v.split('-')
                            return `${MONTHS_ES[parseInt(m) - 1].slice(0, 3)} ${y.slice(2)}`
                          }}
                        />
                        <YAxis tickFormatter={(v) => new Intl.NumberFormat('es-AR', { notation: 'compact' } as any).format(v)} tick={{ fontSize: 11, fill: '#71717a' }} width={50} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#ffffff', borderColor: '#d4d4d8', color: '#18181b' }}
                          itemStyle={{ color: '#18181b' }}
                          formatter={(v: number, name: string) => [formatCurrency(v), name]}
                          labelFormatter={(label) => {
                            const [y, m] = label.split('-')
                            const currentData = chartData.find((d: Record<string, number | string>) => d.month === label)
                            const currentTotal = typeof currentData?.total === 'number' ? currentData.total : 0
                            const currentIdx = monthsRange.indexOf(label)
                            const prevMonth = currentIdx > 0 ? chartData[currentIdx - 1] : null
                            let tooltip = `${MONTHS_ES[parseInt(m) - 1]} ${y}`
                            if (prevMonth && typeof prevMonth.total === 'number') {
                              const diff = currentTotal - prevMonth.total
                              const pct = prevMonth.total > 0 ? ((diff / prevMonth.total) * 100).toFixed(1) : '0'
                              const diffSign = diff >= 0 ? '+' : ''
                              tooltip += `\nvs mes anterior: ${diffSign}${formatCurrency(diff)} (${diffSign}${pct}%)`
                            }
                            return tooltip
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        <Line
                          type="monotone"
                          dataKey="total"
                          name="Total"
                          stroke="#71717a"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={{ r: 4, fill: '#71717a' }}
                          opacity={0.4}
                        />
                        {filteredCards.map((card, idx) => {
                          const cardKey = card.card_name + (card.last4 ? ` (••${card.last4})` : '')
                          return (
                            <Line
                              key={cardKey}
                              type="monotone"
                              dataKey={cardKey}
                              name={card.card_name}
                              stroke={colors[idx % colors.length]}
                              strokeWidth={2}
                              dot={{ r: 3, fill: colors[idx % colors.length] }}
                              connectNulls
                            />
                          )
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )
              })()}
            </div>
          </div>

          {/* Cuentas y Tarjetas - tabla CRUD */}
          {(cardsTable.length > 0 || accountsTable.length > 0) && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-900">Cuentas y Tarjetas</h2>
                <button
                  onClick={handleAddAccount}
                  className="text-xs px-2.5 py-1 rounded-full bg-brand-500 text-white hover:bg-brand-600 transition-all"
                >
                  + Nuevo
                </button>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {accountsTable.map((account) => (
                  <div
                    key={`account-${account.id}`}
                    className="flex-shrink-0 w-40 p-3 rounded-xl border border-zinc-200 bg-white hover:border-zinc-300 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        account.type === 'efectivo' ? 'bg-emerald-100 text-emerald-600' :
                        account.type === 'cuenta_corriente' ? 'bg-blue-100 text-blue-600' :
                        account.type === 'caja_ahorro' ? 'bg-indigo-100 text-indigo-600' :
                        account.type === 'mercadopago' ? 'bg-purple-100 text-purple-600' :
                        'bg-zinc-100 text-zinc-600'
                      }`}>
                        {account.type === 'efectivo' ? 'Efectivo' :
                         account.type === 'cuenta_corriente' ? 'Cta. Corr.' :
                         account.type === 'caja_ahorro' ? 'Caja Ahorro' :
                         account.type === 'mercadopago' ? 'MP' : account.type}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleEditAccount(account)}
                          className="text-zinc-400 hover:text-zinc-600 text-xs"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => { if (confirm(`¿Eliminar "${account.name}"?`)) { deleteAccountMut.mutate(account.id) } }}
                          className="text-zinc-400 hover:text-red-500 text-xs"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-zinc-900 truncate">{account.name}</p>
                  </div>
                ))}
                {cardsTable.map((card) => (
                  <div
                    key={`card-${card.id}`}
                    className="flex-shrink-0 w-48 p-4 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-700 text-zinc-900"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-semibold tracking-widest uppercase">
                        {card.bank || 'Banco'}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleEditCard(card)}
                          className="text-white/60 hover:text-white text-xs"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => { if (confirm(`¿Eliminar "${card.name}"?`)) { deleteCardMut.mutate(card.id) } }}
                          className="text-white/60 hover:text-red-300 text-xs"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    <p className="text-sm font-bold truncate">{card.name}</p>
                    <p className="text-xs mt-2 opacity-70">
                      {card.last4_digits ? `•••• ${card.last4_digits}` : '💳'}
                      <span className="ml-2 text-[10px] opacity-60">
                        {card.card_type === 'credito' ? 'Crédito' : 'Débito'}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Gastos - Full Featured Table */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFiltersOpen(!filtersOpen)}
                  className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border transition-all ${
                    filtersOpen || activeFiltersCount > 0
                      ? 'bg-brand-500/20 border-brand-500/40 text-brand-700'
                      : 'border-zinc-300 text-zinc-600 hover:border-zinc-600'
                  }`}
                >
                  Filtros
                  {activeFiltersCount > 0 && (
                    <span className="bg-brand-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                      {activeFiltersCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => { setSelectMode(v => !v); setSelectedIds(new Set()) }}
                  className={`text-sm px-3 py-1.5 rounded-lg border transition-all ${
                    selectMode
                      ? 'bg-brand-500/20 border-brand-500/40 text-brand-400'
                      : 'border-zinc-300 text-zinc-400 hover:text-zinc-700 hover:border-zinc-600'
                  }`}
                >
                  {selectMode ? 'Cancelar selección' : 'Seleccionar'}
                </button>
              </div>
              {activeFiltersCount > 0 && (
                <button onClick={clearFilters} className="text-xs text-zinc-400 hover:text-zinc-900 flex items-center gap-1">
                  <span className="bg-brand-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">{activeFiltersCount}</span>
                  Limpiar filtros
                </button>
              )}
            </div>

            {/* Filter Panel */}
            {filtersOpen && (
              <div className="mb-4 p-4 bg-zinc-50 rounded-lg border border-zinc-200 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {/* Categoría */}
                  {(() => {
                    const parentIds = new Set(categories.filter(c => c.parent_id).map(c => c.parent_id!))
                    const parents = categories.filter(c => !c.parent_id && parentIds.has(c.id))
                    const orphans = categories.filter(c => !c.parent_id && !parentIds.has(c.id))

                    const handleCategoryFilter = (value: string) => {
                      if (value === '__none__') {
                        setFilter('uncategorized', '1')
                        setFilter('category_id', undefined)
                      } else if (value) {
                        setFilter('category_id', value)
                        setFilter('uncategorized', undefined)
                      } else {
                        setFilter('category_id', undefined)
                        setFilter('uncategorized', undefined)
                      }
                    }

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
                    <option value="">Titular</option>
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
            )}

            {expensesLoading ? (
              <div className="text-center py-10 text-zinc-400">Cargando...</div>
            ) : expenses.length === 0 ? (
              <div className="text-center py-10 text-zinc-400">
                No hay gastos en este período
              </div>
            ) : (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-500">
                      {selectMode && (
                        <th className="pb-2 text-left w-8">
                          <input
                            type="checkbox"
                            checked={selectedIds.size === expenses.length}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedIds(new Set(expenses.map(exp => exp.id)))
                              } else {
                                setSelectedIds(new Set())
                              }
                            }}
                            className="w-4 h-4 text-brand-500 border-zinc-300 rounded focus:ring-brand-500"
                          />
                        </th>
                      )}
                      <th
                        className="pb-2 text-left cursor-pointer hover:text-zinc-900"
                        onClick={() => setSort(s => ({ field: 'date', dir: s.field === 'date' && s.dir === 'asc' ? 'desc' : 'asc' }))}
                      >
                        Fecha
                        <SortIcon field="date" sort={sort} />
                      </th>
                      <th
                        className="pb-2 text-left cursor-pointer hover:text-zinc-900"
                        onClick={() => setSort(s => ({ field: 'description', dir: s.field === 'description' && s.dir === 'asc' ? 'desc' : 'asc' }))}
                      >
                        Descripción
                        <SortIcon field="description" sort={sort} />
                      </th>
                      <th
                        className="pb-2 text-left cursor-pointer hover:text-zinc-900"
                        onClick={() => setSort(s => ({ field: 'category', dir: s.field === 'category' && s.dir === 'asc' ? 'desc' : 'asc' }))}
                      >
                        Categoría
                        <SortIcon field="category" sort={sort} />
                      </th>
                      <th
                        className="pb-2 text-right cursor-pointer hover:text-zinc-900"
                        onClick={() => setSort(s => ({ field: 'amount', dir: s.field === 'amount' && s.dir === 'asc' ? 'desc' : 'asc' }))}
                      >
                        Monto
                        <SortIcon field="amount" sort={sort} />
                      </th>
                      {!selectMode && <th className="pb-2 text-right">Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {expenses
                      .sort((a, b) => {
                        const dir = sort.dir === 'asc' ? 1 : -1
                        if (sort.field === 'date') return (new Date(a.date).getTime() - new Date(b.date).getTime()) * dir
                        if (sort.field === 'description') return a.description.localeCompare(b.description) * dir
                        if (sort.field === 'category') return (a.category_name ?? '').localeCompare(b.category_name ?? '') * dir
                        if (sort.field === 'amount') return (a.amount - b.amount) * dir
                        return 0
                      })
                      .map(exp => (
                        <tr
                          key={exp.id}
                          className={`border-b border-zinc-100 hover:bg-zinc-50 transition-colors ${
                            selectedIds.has(exp.id) ? 'bg-brand-500/10' : ''
                          }`}
                          onClick={selectMode ? () => toggleSelect(exp.id) : undefined}
                          style={selectMode ? { cursor: 'pointer' } : undefined}
                        >
                          {selectMode && (
                            <td className="py-2">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(exp.id)}
                                onChange={() => toggleSelect(exp.id)}
                                className="w-4 h-4 text-brand-500 border-zinc-300 rounded focus:ring-brand-500"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                          )}
                          <td className="py-2 text-zinc-900">{formatDate(exp.date)}</td>
                          <td className="py-2">
                            <div className="text-zinc-900 font-medium">
                              {exp.description}
                              {exp.installment_total && (
                                <span className="ml-2 text-[10px] bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded-full">
                                  {exp.installment_number}/{exp.installment_total}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-zinc-400">
                              {[exp.card, exp.bank, exp.person].filter(Boolean).join(' · ')}
                            </div>
                          </td>
                          <td className="py-2">
                            {exp.category_name && (
                              <span
                                className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full"
                                style={{
                                  backgroundColor: `${exp.category_color || '#6366f1'}20`,
                                  color: exp.category_color || '#6366f1'
                                }}
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: exp.category_color || '#6366f1' }}
                                />
                                {exp.category_name}
                              </span>
                            )}
                          </td>
                          <td className={`py-2 text-right font-semibold ${exp.amount < 0 ? 'text-emerald-600' : 'text-zinc-900'}`}>
                            {formatCurrency(Math.abs(exp.amount), exp.currency)}
                          </td>
                          {!selectMode && (
                            <td className="py-2 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => setEditing(exp)}
                                  className="text-xs text-brand-500 hover:text-brand-700"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => {
                                    if (confirm('¿Eliminar este gasto?')) {
                                      deleteMut.mutate(exp.id)
                                    }
                                  }}
                                  className="text-xs text-red-500 hover:text-red-700"
                                >
                                  Eliminar
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
      </div>

      {/* Expense Modal */}
      {editing !== undefined && (
        <ExpenseModal
          expense={editing}
          isIncome={false}
          onClose={() => {
            setEditing(undefined)
            setSaveError(null)
          }}
          onSave={(data) => {
            if (editing) {
              updateMut.mutate({ id: editing.id, data })
            } else {
              createMut.mutate(data)
            }
          }}
          onDelete={(id) => deleteMut.mutate(id)}
          categories={categories}
          cardSummary={cardSummary}
          saveError={saveError}
        />
      )}

      {/* Bulk Actions Floating Bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white border border-zinc-300 rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-4">
          <span className="text-sm text-zinc-600">
            {selectedIds.size} seleccionado{selectedIds.size > 1 ? 's' : ''}
          </span>

          <select
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value)}
            className="text-sm border border-zinc-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500"
          >
            <option value="">Categoría</option>
            <option value="__none__">Sin categoría</option>
            <optgroup label="Padres">
              {categories.filter(c => !c.parent_id).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
            <optgroup label="Subcategorías">
              {categories.filter(c => c.parent_id).map(c => (
                <option key={c.id} value={c.id}>└ {c.name}</option>
              ))}
            </optgroup>
          </select>

          <button
            onClick={() => {
              if (!bulkCategoryId) return
              const catId = bulkCategoryId === '__none__' ? null : parseInt(bulkCategoryId)
              bulkMut.mutate({ ids: Array.from(selectedIds), catId })
            }}
            disabled={!bulkCategoryId || bulkMut.isPending}
            className="text-sm px-3 py-1.5 bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-all"
          >
            Aplicar
          </button>

          <button
            onClick={() => {
              if (confirm(`¿Eliminar ${selectedIds.size} gasto(s)?`)) {
                bulkDeleteMut.mutate(Array.from(selectedIds))
              }
            }}
            disabled={bulkDeleteMut.isPending}
            className="text-sm px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-all"
          >
            Eliminar
          </button>

          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm px-3 py-1.5 border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-all"
          >
            Limpiar
          </button>
        </div>
      )}
    </div>
  )
}

// Helper functions and components
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
        className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition cursor-pointer"
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

function ExpenseModal({
  expense,
  isIncome = false,
  onClose,
  onSave,
  onDelete: _onDelete,
  categories,
  cardSummary,
  saveError
}: {
  expense?: Expense | null
  isIncome: boolean
  onClose: () => void
  onSave: (data: ExpenseCreate) => void
  onDelete?: (id: number) => void
  categories: Category[]
  cardSummary: CardSummary[]
  saveError?: string | null
}) {
  const isCash = (card: string) => !card || card === 'Efectivo'

  const [payMethod, setPayMethod] = useState<'card' | 'cash'>(
    expense ? (isCash(expense.card ?? '') ? 'cash' : 'card') : isIncome ? 'cash' : 'card'
  )

  const [form, setForm] = useState<ExpenseCreate>(
    expense
      ? {
          date: expense.date,
          description: expense.description,
          amount: Math.abs(expense.amount),
          currency: expense.currency || 'ARS',
          category_id: expense.category_id,
          card: expense.card ?? '',
          bank: expense.bank ?? '',
          person: expense.person ?? '',
          notes: expense.notes ?? '',
          transaction_id: expense.transaction_id ?? '',
          card_last4: expense.card_last4 ?? '',
          installment_number: expense.installment_number ?? null,
          installment_total: expense.installment_total ?? null,
          installment_group_id: expense.installment_group_id ?? null,
        }
      : EMPTY_FORM,
  )

  const [cuotasEnabled, setCuotasEnabled] = useState(
    !!(expense?.installment_total && expense.installment_total > 1)
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
            {expense
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
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-zinc-600 mb-1">Monto</label>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => set('amount', parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">Moneda</label>
            <select value={form.currency ?? 'ARS'} onChange={(e) => set('currency', e.target.value)} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition">
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
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
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
          <select value={form.person ?? ''} onChange={(e) => handlePersonChange(e.target.value)} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition">
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
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition disabled:opacity-50"
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
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition disabled:opacity-50"
              >
                <option value="">— Tarjeta —</option>
                {availableCards.map(c => {
                  const val = c.last4 ? `${c.card_name}|${c.last4}` : c.card_name
                  return <option key={val} value={val}>{cardLabel(c)}</option>
                })}
              </select>
            </div>
          </div>
          {/* Last 4 digits */}
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
                className="w-20 px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition font-mono tracking-widest text-center"
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
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition text-center"
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
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition text-center"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-1">Notas</label>
          <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition" rows={2} />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-white border border-zinc-300 text-zinc-700 rounded-lg hover:bg-zinc-50 transition-colors font-medium text-sm">Cancelar</button>
          <button
            onClick={() => onSave({ ...form, amount: isIncome ? -Math.abs(form.amount) : Math.abs(form.amount) })}
            className={`flex-1 ${isIncome ? 'bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors' : 'px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors font-medium text-sm'}`}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}