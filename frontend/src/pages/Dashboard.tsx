import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { getDashboard, getCardSummary, getExpenses } from '../api/client'

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

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

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'green' | 'red' | 'blue'
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
  const navigate = useNavigate()

  // 7 days ago
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 7)
  const dateFrom = `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(sevenDaysAgo.getDate()).padStart(2, '0')}`

  const { data: dashData } = useQuery({
    queryKey: ['dashboard', currentMonth],
    queryFn: () => getDashboard({ month: currentMonth }),
    placeholderData: (prev) => prev,
  })

  const { data: cardData = [] } = useQuery({
    queryKey: ['card-summary'],
    queryFn: getCardSummary,
  })

  const { data: recentExpenses = [] } = useQuery({
    queryKey: ['expenses-recent-7d', dateFrom],
    queryFn: () => getExpenses({ date_from: dateFrom, limit: 30 }),
  })

  // Compute balance/ingresos/gastos
  const gastos = dashData?.by_currency.find(c => c.currency === 'ARS')?.total ?? dashData?.total_amount ?? 0
  // Ingresos = sum of negative amounts (credits) in current month, derive from category totals
  const ingresos = dashData?.by_category.reduce((acc, c) => c.total < 0 ? acc + Math.abs(c.total) : acc, 0) ?? 0
  const balance = ingresos - gastos

  // Balance evolution — use trend_data.history
  const balanceHistory = (dashData?.trend_data?.history ?? []).map(h => ({
    month: h.month,
    label: (() => {
      const [, m] = h.month.split('-')
      return MONTHS_ES[parseInt(m) - 1]
    })(),
    gastos: Math.abs(h.total),
  }))

  // Category budgets — show top categories by spending (no budget feature yet, just spend)
  const topCategories = [...(dashData?.by_category ?? [])]
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  const maxCatTotal = topCategories[0]?.total ?? 1

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Finanzas Personales</h1>
        <p className="text-sm text-zinc-400 mt-0.5">Resumen de {MONTHS_ES[now.getMonth()]} {now.getFullYear()}</p>
      </div>

      {/* Top 3 stat boxes */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Balance"
          value={formatCurrency(balance)}
          sub={balance >= 0 ? 'Superávit del mes' : 'Déficit del mes'}
          accent={balance >= 0 ? 'green' : 'red'}
        />
        <StatCard
          label="Ingresos"
          value={formatCurrency(ingresos)}
          sub="Acreditaciones del mes"
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
                  const monthEntry = card.monthly?.find(m => m.month === currentMonth)
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
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-900">Próximos Gastos Programados</h2>
            </div>
            <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
              <span className="text-3xl opacity-30">📅</span>
              <p className="text-sm text-zinc-400">Próximamente</p>
              <p className="text-xs text-zinc-300">Los gastos programados y vencimientos aparecerán aquí</p>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Balance evolution area chart */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-zinc-900 mb-4">Evolución de Gastos</h2>
            {balanceHistory.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-10">Sin datos históricos</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={balanceHistory} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={(v) => new Intl.NumberFormat('es-AR', { notation: 'compact' } as any).format(v)}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    width={48}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [formatCurrency(v), 'Gastos']}
                  />
                  <Area
                    type="monotone"
                    dataKey="gastos"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#areaGrad)"
                    dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: '#6366f1' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Category budgets */}
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
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: cat.category_color || '#94a3b8' }}
                          />
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

      {/* Last 7 days transactions */}
      <div className="card">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">Transacciones — Últimos 7 días</h2>
          <button
            onClick={() => navigate('/expenses')}
            className="text-xs text-brand-500 hover:text-brand-400 transition-colors"
          >
            Ver todos →
          </button>
        </div>
        {recentExpenses.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-10">Sin transacciones en los últimos 7 días</p>
        ) : (
          <div className="divide-y divide-zinc-100">
            {recentExpenses.map((exp) => (
              <div key={exp.id} className="flex items-center justify-between px-5 py-3 hover:bg-zinc-50 transition-colors">
                <div className="flex items-center gap-3">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: exp.category_color || '#94a3b8' }}
                  />
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
