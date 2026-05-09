import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { getDashboard, getCardSummary, getExpenses, getScheduledSummary, getAccountExpenses } from '../api/client'

const MONTHS_ES_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

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

function StatCard({
  label, value, sub, accent,
}: {
  label: string; value: string; sub?: string; accent?: 'green' | 'red' | 'blue'
}) {
  const accentMap = {
    green: 'border-l-4 border-success',
    red: 'border-l-4 border-danger',
    blue: 'border-l-4 border-primary',
  }
  return (
    <div className={`card p-5 ${accent ? accentMap[accent] : ''}`}>
      <p className="text-xs font-medium text-secondary uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-primary leading-tight">{value}</p>
      {sub && <p className="text-xs text-tertiary mt-1">{sub}</p>}
    </div>
  )
}

function CardRow({ cardName, bank, total, cardType, holder }: { cardName: string; bank: string; total: number; cardType?: string; holder?: string }) {
  const isAccount = !bank || cardName.toLowerCase().includes('efectivo') || cardName.toLowerCase().includes('cuenta')

  const renderIcon = () => {
    if (isAccount) {
      if (cardName.toLowerCase().includes('efectivo')) return '💵'
      if (cardName.toLowerCase().includes('mercadopago') || cardName.toLowerCase().includes('mp')) return '📱'
      return '🏦'
    }
    return '💳'
  }

  const getNetwork = (name: string): string => {
    const n = name.toLowerCase()
    if (n.includes('visa')) return 'Visa'
    if (n.includes('mastercard') || n.includes('master card')) return 'Mastercard'
    if (n.includes('amex') || n.includes('american express')) return 'Amex'
    return name.split(' ')[0]
  }

  const getFirstName = (fullName: string): string => {
    if (!fullName) return ''
    return fullName.split(' ')[0]
  }

  const network = getNetwork(cardName)
  const displayName = cardType === 'debito' ? 'Débito' : network
  const firstName = holder ? getFirstName(holder) : ''

  return (
    <div className="flex items-center justify-between py-2.5 px-1">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg ${isAccount ? 'bg-success/10' : 'bg-base-alt'} flex items-center justify-center text-xs`}>
          {renderIcon()}
        </div>
        <div>
          <p className="text-sm font-medium text-primary leading-tight">
            {firstName || displayName}{bank ? ` | ${bank}` : ''}
          </p>
        </div>
      </div>
      <span className="text-sm font-semibold text-primary">{formatCurrency(total)}</span>
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

  // Expenses for the full selected month (used for balance evolution chart)
  const { data: areaExpenses = [] } = useQuery({
    queryKey: ['account-expenses-chart', month],
    queryFn: () => getAccountExpenses(month),
  })

  // Expenses for 7-day transaction list
  const { data: recentExpenses = [] } = useQuery({
    queryKey: ['expenses-recent-7d', toYMD(sevenDaysAgo), toYMD(toDate)],
    queryFn: () => getExpenses({ date_from: toYMD(sevenDaysAgo), date_to: toYMD(toDate), limit: 30 }),
  })

  // Scheduled expenses for current month
  const { data: scheduledData } = useQuery({
    queryKey: ['scheduled-summary'],
    queryFn: () => getScheduledSummary(),
  })

  // Compute balance/ingresos/gastos from selected month (excluir tarjetas de credito)
  const gastos = dashData?.total_by_account ?? 0
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

  // Build cumulative balance for area chart — all days of selected month up to toDate
  const dailyChart = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const firstDay = new Date(y, m - 1, 1)
    const lastDay = toDate
    let cumulative = 0
    const days: { date: string; label: string; balance: number }[] = []
    const cur = new Date(firstDay)
    while (cur <= lastDay) {
      const ymd = toYMD(cur)
      const label = `${String(cur.getDate()).padStart(2, '0')}`
      const dayNet = areaExpenses
        .filter(e => normalizeDate(e.date) === ymd)
        .reduce((s, e) => s + (-e.amount), 0) // credits (+), debits (-)
      cumulative += dayNet
      days.push({ date: ymd, label, balance: cumulative })
      cur.setDate(cur.getDate() + 1)
    }
    return days
  }, [areaExpenses, month, toDate])

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
          <h1 className="text-2xl font-bold text-primary">Finanzas Personales</h1>
          <p className="text-sm text-secondary mt-0.5">
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
              <h2 className="text-sm font-semibold text-primary">Tarjetas de Crédito</h2>
              <button
                onClick={() => navigate('/accounts')}
                className="text-xs text-primary hover:brightness-110 transition-colors"
              >
                Ver detalle →
              </button>
            </div>
            {cardData.length === 0 ? (
              <p className="text-sm text-secondary text-center py-6">Sin tarjetas registradas</p>
            ) : (
              <div className="divide-y divide-border-color">
                {cardData.map((card, i) => {
                  const monthEntry = card.monthly?.find(m => m.month === month)
                  return (
                    <CardRow
                      key={i}
                      cardName={card.card_name}
                      bank={card.bank}
                      total={monthEntry?.total ?? 0}
                      cardType={card.card_type}
                      holder={card.holder}
                    />
                  )
                })}
              </div>
            )}
          </div>

          {/* Scheduled expenses */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-primary mb-3">Próximos Gastos Programados</h2>
            {(!scheduledData || (scheduledData.installments.length === 0 && scheduledData.manual.length === 0)) ? (
              <div className="flex flex-col items-center justify-center py-6 text-center gap-2">
                <span className="text-3xl opacity-30">📅</span>
                <p className="text-sm text-secondary">Sin gastos programados</p>
                <p className="text-xs text-tertiary">Los vencimientos del mes aparecerán aquí</p>
              </div>
            ) : (
              <div className="space-y-2">
                {scheduledData.installments.map((inst) => (
                  <div key={`inst-${inst.id}`} className="flex items-center justify-between py-2 px-1 rounded hover:bg-base-alt transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-base">📦</span>
                      <div>
                        <p className="text-sm font-medium text-primary">{inst.description}</p>
                        <p className="text-xs text-tertiary">
                          {formatDate(inst.scheduled_date)} · {inst.installment_number}/{inst.installment_total}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-primary">{formatCurrency(inst.amount, inst.currency)}</span>
                  </div>
                ))}
                {scheduledData.manual.map((man) => (
                  <div key={`man-${man.id}`} className="flex items-center justify-between py-2 px-1 rounded hover:bg-base-alt transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-base">📅</span>
                      <div>
                        <p className="text-sm font-medium text-primary">{man.description}</p>
                        <p className="text-xs text-tertiary">{formatDate(man.scheduled_date)}</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-primary">{formatCurrency(man.amount, man.currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Daily area chart — last 10 days */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-primary">Evolución del balance</h2>
              <span className="text-xs text-tertiary">{MONTHS_ES_LONG[parseInt(month.split('-')[1]) - 1]}</span>
            </div>
            {areaExpenses.length === 0 ? (
              <p className="text-sm text-secondary text-center py-10">Sin movimientos en este período</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={dailyChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaGradPos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#33d17a" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#33d17a" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="areaGradNeg" x1="0" y1="1" x2="0" y2="0">
                      <stop offset="5%" stopColor="#e01b24" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#e01b24" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--chart-text)' }} axisLine={false} tickLine={false} interval={4} minTickGap={20} />
                  <YAxis
                    tickFormatter={(v) => new Intl.NumberFormat('es-AR', { notation: 'compact' } as any).format(v)}
                    tick={{ fontSize: 10, fill: 'var(--chart-text)' }}
                    width={48}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', borderColor: 'var(--chart-tooltip-border)', color: 'var(--chart-tooltip-text)', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [formatCurrency(v), 'Balance acumulado']}
                    labelFormatter={(label) => label}
                  />
                  {(() => {
                    const hasPos = dailyChart.some(d => d.balance >= 0)
                    const allNeg = !hasPos
                    const color = allNeg ? '#e01b24' : '#33d17a'
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
              <h2 className="text-sm font-semibold text-primary">Gasto por Categoría</h2>
              <button
                onClick={() => navigate('/cat-dashboard')}
                className="text-xs text-primary hover:brightness-110 transition-colors"
              >
                Ver todo →
              </button>
            </div>
            {topCategories.length === 0 ? (
              <p className="text-sm text-secondary text-center py-6">Sin datos</p>
            ) : (
              <div className="space-y-3">
                {topCategories.map((cat, i) => {
                  const pct = (cat.total / maxCatTotal) * 100
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.category_color || '#9a9996' }} />
                          <span className="text-xs text-secondary font-medium">{cat.category_name}</span>
                        </div>
                        <span className="text-xs font-semibold text-primary">{formatCurrency(cat.total)}</span>
                      </div>
                      <div className="h-1.5 bg-base-alt rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: cat.category_color || '#9a9996' }}
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
        <div className="px-5 py-4 border-b border-border-color flex items-center justify-between">
          <h2 className="text-sm font-semibold text-primary">
            Transacciones — Últimos 7 días{!isCurrentMonth && ` (al ${formatDate(toYMD(toDate))})`}
          </h2>
          <button
            onClick={() => navigate('/expenses')}
            className="text-xs text-primary hover:brightness-110 transition-colors"
          >
            Ver todos →
          </button>
        </div>
        {recentExpenses.length === 0 ? (
          <p className="text-sm text-secondary text-center py-10">Sin transacciones en este período</p>
        ) : (
          <div className="divide-y divide-border-color">
            {recentExpenses.map((exp) => (
              <div key={exp.id} className="flex items-center justify-between px-5 py-3 hover:bg-base-alt transition-colors">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: exp.category_color || '#9a9996' }} />
                  <div>
                    <p className="text-sm font-medium text-primary">{exp.description}</p>
                    <p className="text-xs text-tertiary">
                      {formatDate(exp.date)}
                      {exp.category_name ? ` · ${exp.category_name}` : ''}
                      {exp.card ? ` · ${exp.card}` : ''}
                    </p>
                  </div>
                </div>
                <span className={`text-sm font-semibold ${exp.amount < 0 ? 'text-success' : 'text-primary'}`}>
                  {exp.currency === 'USD' && (
                    <span className="text-xs font-normal badge-success px-1.5 py-0.5 rounded mr-1">USD</span>
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
