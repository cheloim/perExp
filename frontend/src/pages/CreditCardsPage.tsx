import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  PieChart, Pie, Cell,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { getExpenses, getCardSummary, getDashboard, getCardCategoryBreakdown } from '../api/client'
import type { CategorySummary } from '../types'

type GroupBy = 'month' | 'year'

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
            •••• {hasDigits ? last4 : '????'}
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

function MonthSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y, m] = value.split('-').map(Number)

  const shift = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1)
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div className="flex items-center gap-0.5 bg-zinc-100 border border-zinc-300 rounded-lg px-1 py-1">
      <button onClick={() => shift(-1)} className="px-2 py-0.5 text-zinc-400 hover:text-zinc-900 rounded transition-colors">◀</button>
      <span className="text-zinc-900 text-sm font-medium px-3 min-w-[130px] text-center select-none">
        {MONTHS_ES[m - 1]} {y}
      </span>
      <button onClick={() => shift(1)} className="px-2 py-0.5 text-zinc-400 hover:text-zinc-900 rounded transition-colors">▶</button>
    </div>
  )
}


export default function CreditCardsPage() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [month, setMonth] = useState(currentMonth)
  const [groupBy, setGroupBy] = useState<GroupBy>('month')
  const [activeCat, setActiveCat] = useState<CategorySummary | null>(null)
  const [activeCard, setActiveCard] = useState<string | null>(null)
  const [bankFilter, setBankFilter] = useState<string | null>(null)
  const navigate = useNavigate()

  const { data: cardData = [] } = useQuery({
    queryKey: ['card-summary'],
    queryFn: getCardSummary,
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

  const { data: cardCategoryData } = useQuery({
    queryKey: ['card-category-breakdown', month, activeCardLast4, bankFilter],
    queryFn: () => getCardCategoryBreakdown({
      month: month || undefined,
      card_last4: activeCardLast4 || undefined,
      bank: bankFilter || undefined,
    }),
    staleTime: 60_000,
  })

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
      <div className="flex flex-wrap items-center gap-3">
        <MonthSelector value={month} onChange={(v) => { setMonth(v); setActiveCat(null) }} />

        <div className="flex items-center gap-1 bg-zinc-100 border border-zinc-300 rounded-lg p-0.5">
          {(['month', 'year'] as GroupBy[]).map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={`px-3 py-1 text-xs rounded-md transition-all ${
                groupBy === g ? 'bg-zinc-600 text-zinc-900 font-medium' : 'text-zinc-400 hover:text-zinc-600'
              }`}
            >
              {g === 'month' ? 'Mes' : 'Año'}
            </button>
          ))}
        </div>
      </div>

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
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="total"
                        nameKey="category_name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={30}
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
              <h2 className="text-base font-semibold text-zinc-900 mb-4">Gastos por Tarjeta</h2>
              {!cardCategoryData || cardCategoryData.rows.length === 0 ? (
                <p className="text-zinc-500 text-sm text-center py-12">Sin datos</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={cardCategoryData.rows} margin={{ top: 4, right: 4, left: 0, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis
                        dataKey="card"
                        tick={{ fontSize: 10, fill: '#a1a1aa' }}
                        angle={-30}
                        textAnchor="end"
                        interval={0}
                      />
                      <YAxis tickFormatter={(v) => new Intl.NumberFormat('es-AR', { notation: 'compact' } as any).format(v)} tick={{ fontSize: 11, fill: '#a1a1aa' }} width={50} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#f4f4f5' }}
                        itemStyle={{ color: '#f4f4f5' }}
                        formatter={(v: number, name: string) => [formatCurrency(v), name]}
                      />
                      {cardCategoryData.categories.map((cat) => (
                        <Bar key={cat.name} dataKey={cat.name} stackId="a" fill={cat.color || '#94a3b8'} radius={[0,0,0,0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {cardCategoryData.categories.map(cat => (
                      <span key={cat.name} className="flex items-center gap-1 text-xs text-zinc-400">
                        <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: cat.color || '#94a3b8' }} />
                        {cat.name}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="px-5 py-4 border-b border-zinc-200">
              <h2 className="text-base font-semibold text-zinc-900">Últimos Gastos</h2>
            </div>
            {data.recent_expenses.length === 0 ? (
              <p className="text-zinc-500 text-sm text-center py-10">Aún no hay gastos registrados</p>
            ) : (
              <div className="divide-y divide-zinc-200">
                {data.recent_expenses.map((exp) => (
                  <div key={exp.id} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => navigate(`/expenses?category_id=${exp.category_id}`)}
                        disabled={!exp.category_id}
                        className="inline-block w-3 h-3 rounded-full flex-shrink-0 disabled:cursor-default"
                        style={{ backgroundColor: exp.category_color || '#94a3b8' }}
                        title={exp.category_name ?? undefined}
                      />
                      <div>
                        <p className="text-sm font-medium text-zinc-900">{exp.description}</p>
                        <p className="text-xs text-zinc-500">
                          {formatDate(exp.date)} · {exp.category_name ?? 'Sin categoría'}
                        </p>
                      </div>
                    </div>
                    <span className={`text-sm font-semibold flex items-center gap-1.5 ${exp.amount < 0 ? 'text-green-400' : 'text-zinc-900'}`}>
                      {exp.currency === 'USD' && (
                        <span className="text-xs font-normal bg-green-100 text-green-700 px-1.5 py-0.5 rounded">USD</span>
                      )}
                      {formatCurrency(exp.amount, exp.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
      </div>
    </div>
  )
}