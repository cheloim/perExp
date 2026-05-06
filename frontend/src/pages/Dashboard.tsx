import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { getDashboard, getCardSummary, getExpenses } from '../api/client'

const MONTHS_ES_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MONTHS_ES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatCurrency(amount: number, currency = 'ARS') {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount)
  }
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount)
}

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [y, m, d] = dateStr.split('-')
    return `${d}/${m}/${y}`
  }
  return dateStr
}

function MonthSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y, m] = value.split('-').map(Number)
  const shift = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1)
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const now = new Date()
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth() + 1
  return (
    <div className="flex items-center gap-0.5 bg-zinc-100 border border-zinc-200 rounded-lg px-1 py-1">
      <button onClick={() => shift(-1)} className="px-2 py-0.5 text-zinc-400 hover:text-zinc-900 rounded transition-colors">◀</button>
      <span className="text-zinc-900 text-sm font-medium px-3 min-w-[140px] text-center select-none">
        {MONTHS_ES_LONG[m - 1]} {y}
      </span>
      <button
        onClick={() => shift(1)}
        disabled={isCurrentMonth}
        className="px-2 py-0.5 text-zinc-400 hover:text-zinc-900 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >▶</button>
    </div>
  )
}

function StatCard({
  label, value, sub, accent,
}: {
  label: string; value: string; sub?: string; accent?: 'green' | 'red' | 'blue'
}) {
  const accentMap = {
    green: 'border-l-4 border-emerald-500',
    red: 'border-l-4 border-rose-500',
    blue: 'border-l-4 border-brand-500',
  }
  return (
    <div className={`card p-5 ${accent ? accentMap[accent] : ''}`}>
      <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-zinc-900 leading-tight">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  )
}

function CardRow({ last4, cardName, bank, total }: { last4: string; cardName: string; bank: string; total: number }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-1">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center text-xs font-mono text-zinc-500 font-semibold">
          {last4 && /^\d{4}$/.test(last4) ? last4 : '????'}
        </div>
        <div>
          <p className="text-sm font-medium text-zinc-900 leading-tight">{cardName}</p>
          <p className="text-xs text-zinc-400">{bank}</p>
        </div>
      </div>
      <span className="text-sm font-semibold text-zinc-900">{formatCurrency(total)}</span>
    </div>
  )
}

export default function Dashboard() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [month, setMonth] = useState(currentMonth)
  const navigate = useNavigate()

  const isCurrentMonth = month === currentMonth

  // "To" date: today if current month, else last day of selected month
  const toDate = useMemo(() => {
    if (isCurrentMonth) return now
    const [y, m] = month.split('-').map(Number)
    return new Date(y, m, 0) // last day of month
  }, [month, isCurrentMonth])

  // 40 days back from toDate
  const tenDaysAgo = useMemo(() => {
    const d = new Date(toDate)
    d.setDate(d.getDate() - 39)
    return d
  }, [toDate])

  // 7 days back from toDate for transactions list
  const sevenDaysAgo = useMemo(() => {
    const d = new Date(toDate)
    d.setDate(d.getDate() - 6)
    return d
  }, [toDate])

  const { data: dashData } = useQuery({
    queryKey: ['dashboard', month],
    queryFn: () => getDashboard({ month }),
    placeholderData: (prev) => prev,
  })

  const { data: cardData = [] } = useQuery({
    queryKey: ['card-summary'],
    queryFn: getCardSummary,
  })

  // Expenses for 10-day area chart
  const { data: areaExpenses = [] } = useQuery({
    queryKey: ['expenses-10d-chart', toYMD(tenDaysAgo), toYMD(toDate)],
    queryFn: () => getExpenses({ date_from: toYMD(tenDaysAgo), date_to: toYMD(toDate), limit: 500 }),
  })

  // Expenses for 7-day transaction list
  const { data: recentExpenses = [] } = useQuery({
    queryKey: ['expenses-recent-7d', toYMD(sevenDaysAgo), toYMD(toDate)],
    queryFn: () => getExpenses({ date_from: toYMD(sevenDaysAgo), date_to: toYMD(toDate), limit: 30 }),
  })

  // Compute balance/ingresos/gastos from selected month
  const gastos = dashData?.by_currency.find(c => c.currency === 'ARS')?.total ?? dashData?.total_amount ?? 0
  const ingresos = dashData?.by_category.reduce((acc, c) => c.total < 0 ? acc + Math.abs(c.total) : acc, 0) ?? 0
  const balance = ingresos - gastos

  // Normalize API date (DD-MM-YYYY or YYYY-MM-DD) → YYYY-MM-DD for comparison
  const normalizeDate = (d: string) => {
    if (!d) return d
    if (/^\d{2}-\d{2}-\d{4}$/.test(d)) {
      const [dd, mm, yyyy] = d.split('-')
      return `${yyyy}-${mm}-${dd}`
    }
    return d
  }

  // Build cumulative balance for area chart (last 40 days)
  // ingresos = negative amounts (credits), gastos = positive amounts (debits)
  const dailyChart = useMemo(() => {
    let cumulative = 0
    const days: { date: string; label: string; balance: number }[] = []
    for (let i = 0; i < 40; i++) {
      const d = new Date(tenDaysAgo)
      d.setDate(d.getDate() + i)
      const ymd = toYMD(d)
      const label = `${String(d.getDate()).padStart(2, '0')}/${MONTHS_ES_SHORT[d.getMonth()]}`
      const dayNet = areaExpenses
        .filter(e => normalizeDate(e.date) === ymd)
        .reduce((s, e) => s + (-e.amount), 0) // income positive, expense negative
      cumulative += dayNet
      days.push({ date: ymd, label, balance: cumulative })
    }
    return days
  }, [areaExpenses, tenDaysAgo])

  // Category budgets — top 5 by spending
  const topCategories = [...(dashData?.by_category ?? [])]
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  const maxCatTotal = topCategories[0]?.total ?? 1

  return (
    <div className="space-y-6">
      {/* Page header + period selector */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Finanzas Personales</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            {isCurrentMonth ? 'Mes en curso' : 'Período seleccionado'}
          </p>
        </div>
        <MonthSelector value={month} onChange={setMonth} />
      </div>

      {/* Top 3 stat boxes */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Balance"
          value={formatCurrency(balance)}
          sub={balance >= 0 ? 'Superávit del período' : 'Déficit del período'}
          accent={balance >= 0 ? 'green' : 'red'}
        />
        <StatCard
          label="Ingresos"
          value={formatCurrency(ingresos)}
          sub="Acreditaciones del período"
          accent="green"
        />
        <StatCard
          label="Gastos"
          value={formatCurrency(gastos)}
          sub={`${dashData?.total_expenses ?? 0} transacciones`}
          accent="red"
        />
      </div>

      {/* Middle section: left (cards + scheduled), right (area chart + budgets) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left column */}
        <div className="space-y-4">
          {/* Credit cards */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-900">Tarjetas de Crédito</h2>
              <button
                onClick={() => navigate('/credit-cards')}
                className="text-xs text-brand-500 hover:text-brand-400 transition-colors"
              >
                Ver detalle →
              </button>
            </div>
            {cardData.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-6">Sin tarjetas registradas</p>
            ) : (
              <div className="divide-y divide-zinc-100">
                {cardData.map((card, i) => {
                  const monthEntry = card.monthly?.find(m => m.month === month)
                  return (
                    <CardRow
                      key={i}
                      last4={card.last4}
                      cardName={card.card_name}
                      bank={card.bank}
                      total={monthEntry?.total ?? 0}
                    />
                  )
                })}
              </div>
            )}
          </div>

          {/* Scheduled expenses placeholder */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-zinc-900 mb-3">Próximos Gastos Programados</h2>
            <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
              <span className="text-3xl opacity-30">📅</span>
              <p className="text-sm text-zinc-400">Próximamente</p>
              <p className="text-xs text-zinc-300">Los gastos programados y vencimientos aparecerán aquí</p>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Daily area chart — last 10 days */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-900">Evolución del balance</h2>
              <span className="text-xs text-zinc-400">Últimos 40 días</span>
            </div>
            {areaExpenses.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-10">Sin movimientos en este período</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={dailyChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaGradPos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="areaGradNeg" x1="0" y1="1" x2="0" y2="0">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={4} />
                  <YAxis
                    tickFormatter={(v) => new Intl.NumberFormat('es-AR', { notation: 'compact' } as any).format(v)}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    width={48}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [formatCurrency(v), 'Balance acumulado']}
                    labelFormatter={(label) => label}
                  />
                  {(() => {
                    const hasPos = dailyChart.some(d => d.balance >= 0)
                    const allNeg = !hasPos
                    const color = allNeg ? '#f43f5e' : '#10b981'
                    const grad = allNeg ? 'url(#areaGradNeg)' : 'url(#areaGradPos)'
                    return (
                      <Area
                        type="monotone"
                        dataKey="balance"
                        stroke={color}
                        strokeWidth={2}
                        fill={grad}
                        dot={false}
                        activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
                        baseValue={0}
                      />
                    )
                  })()}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Category spending */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-900">Gasto por Categoría</h2>
              <button
                onClick={() => navigate('/cat-dashboard')}
                className="text-xs text-brand-500 hover:text-brand-400 transition-colors"
              >
                Ver todo →
              </button>
            </div>
            {topCategories.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-6">Sin datos</p>
            ) : (
              <div className="space-y-3">
                {topCategories.map((cat, i) => {
                  const pct = (cat.total / maxCatTotal) * 100
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.category_color || '#94a3b8' }} />
                          <span className="text-xs text-zinc-600 font-medium">{cat.category_name}</span>
                        </div>
                        <span className="text-xs font-semibold text-zinc-900">{formatCurrency(cat.total)}</span>
                      </div>
                      <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: cat.category_color || '#94a3b8' }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">
            Transacciones — Últimos 7 días{!isCurrentMonth && ` (al ${formatDate(toYMD(toDate))})`}
          </h2>
          <button
            onClick={() => navigate('/expenses')}
            className="text-xs text-brand-500 hover:text-brand-400 transition-colors"
          >
            Ver todos →
          </button>
        </div>
        {recentExpenses.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-10">Sin transacciones en este período</p>
        ) : (
          <div className="divide-y divide-zinc-100">
            {recentExpenses.map((exp) => (
              <div key={exp.id} className="flex items-center justify-between px-5 py-3 hover:bg-zinc-50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: exp.category_color || '#94a3b8' }} />
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{exp.description}</p>
                    <p className="text-xs text-zinc-400">
                      {formatDate(exp.date)}
                      {exp.category_name ? ` · ${exp.category_name}` : ''}
                      {exp.card ? ` · ${exp.card}` : ''}
                    </p>
                  </div>
                </div>
                <span className={`text-sm font-semibold ${exp.amount < 0 ? 'text-emerald-500' : 'text-zinc-900'}`}>
                  {exp.currency === 'USD' && (
                    <span className="text-xs font-normal bg-green-100 text-green-700 px-1.5 py-0.5 rounded mr-1">USD</span>
                  )}
                  {formatCurrency(exp.amount, exp.currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
