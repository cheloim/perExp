import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Legend,
} from 'recharts'
import { getDashboard, getCardSummary, getExpenses, getScheduledSummary, getCategoryTrend, getAccountExpenses, getInvestments } from '../api/client'
import { formatCurrency, toUpperCase } from '../utils/format'

const MONTHS_ES_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MONTHS_ES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
  const [trendMonths, setTrendMonths] = useState(3)
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

  // Category trend for evolution chart
  const { data: categoryTrendData } = useQuery({
    queryKey: ['category-trend', trendMonths],
    queryFn: () => getCategoryTrend(trendMonths),
  })

  // Current month key for calculations
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const prevMonthKey = useMemo(() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [now])

  // Account expenses for current and previous month
  const { data: accountExpensesCurrent = [] } = useQuery({
    queryKey: ['account-expenses', currentMonthKey],
    queryFn: () => getAccountExpenses(currentMonthKey),
  })

  const { data: accountExpensesPrev = [] } = useQuery({
    queryKey: ['account-expenses', prevMonthKey],
    queryFn: () => getAccountExpenses(prevMonthKey),
  })

  // Investments
  const { data: investments = [] } = useQuery({
    queryKey: ['investments'],
    queryFn: () => getInvestments(),
  })

  // Calculate account summary with variations (using card field to identify non-card expenses)
  const accountSummary = useMemo(() => {
    // Group by account name from accountExpenses where card is empty (non-card expenses)
    const currentByAccount: Record<string, number> = {}
    const prevByAccount: Record<string, number> = {}
    
    accountExpensesCurrent.forEach(e => {
      if (!e.card) {
        currentByAccount[e.person || 'Sin asignar'] = (currentByAccount[e.person || 'Sin asignar'] || 0) + e.amount
      }
    })
    accountExpensesPrev.forEach(e => {
      if (!e.card) {
        prevByAccount[e.person || 'Sin asignar'] = (prevByAccount[e.person || 'Sin asignar'] || 0) + e.amount
      }
    })
    
    return Object.entries(currentByAccount).map(([name, total]) => {
      const prevTotal = prevByAccount[name] || 0
      const variation = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0
      return { id: name, name, total, variation }
    }).filter(a => a.total > 0)
  }, [accountExpensesCurrent, accountExpensesPrev])

  // Calculate card summary with variations (only credit cards)
  const cardSummary = useMemo(() => {
    return cardData
      .filter(c => c.card_type === 'credito')
      .map(card => {
        const currentEntry = card.monthly?.find(m => m.month === currentMonthKey)
        const prevEntry = card.monthly?.find(m => m.month === prevMonthKey)
        const currentTotal = currentEntry?.total ?? 0
        const prevTotal = prevEntry?.total ?? 0
        const variation = prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : 0
        return {
          name: card.card_name,
          bank: card.bank,
          total: currentTotal,
          variation,
        }
      }).filter(c => c.total > 0)
  }, [cardData, currentMonthKey, prevMonthKey])

  // Calculate total investments value
  const investmentsTotal = useMemo(() => {
    const total = investments.reduce((sum, inv) => {
      const price = inv.current_price ?? inv.avg_cost ?? 0
      return sum + (inv.quantity * price)
    }, 0)
    return total
  }, [investments])

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

      {/* Accounts/Cards/Investments Summary */}
      <div className="space-y-4">
        {/* Cuentas */}
        {accountSummary.length > 0 && (
          <div className="card p-4">
            <h2 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Cuentas</h2>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {accountSummary.map(acc => (
                <div key={acc.id} className="flex-shrink-0 w-32 bg-base-alt rounded-lg p-3">
                  <p className="text-xs font-medium text-primary truncate" title={acc.name}>{acc.name}</p>
                  <p className="text-sm font-bold text-primary mt-1">{formatCurrency(acc.total)}</p>
                  <p className={`text-xs mt-1 ${acc.variation > 0 ? 'text-success' : acc.variation < 0 ? 'text-danger' : 'text-tertiary'}`}>
                    {acc.variation > 0 ? '↑' : acc.variation < 0 ? '↓' : '→'} {Math.abs(acc.variation).toFixed(0)}%
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tarjetas */}
        {cardSummary.length > 0 && (
          <div className="card p-4">
            <h2 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Tarjetas</h2>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {cardSummary.map((card, idx) => (
                <div key={idx} className="flex-shrink-0 w-32 bg-base-alt rounded-lg p-3">
                  <p className="text-xs font-medium text-primary truncate" title={card.name}>{card.name}</p>
                  <p className="text-sm font-bold text-primary mt-1">{formatCurrency(card.total)}</p>
                  <p className={`text-xs mt-1 ${card.variation > 0 ? 'text-success' : card.variation < 0 ? 'text-danger' : 'text-tertiary'}`}>
                    {card.variation > 0 ? '↑' : card.variation < 0 ? '↓' : '→'} {Math.abs(card.variation).toFixed(0)}%
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inversiones */}
        {investmentsTotal > 0 && (
          <div className="card p-4">
            <h2 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">Inversiones</h2>
            <p className="text-xl font-bold text-primary">Total: {formatCurrency(investmentsTotal)}</p>
          </div>
        )}
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
                        <p className="text-sm font-medium text-primary">{toUpperCase(inst.description)}</p>
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
                        <p className="text-sm font-medium text-primary">{toUpperCase(man.description)}</p>
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
          {/* Category evolution chart */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-primary">Evolución de gastos por categoría</h2>
              <div className="flex gap-1">
                {[1, 3, 6].map(m => (
                  <button
                    key={m}
                    onClick={() => setTrendMonths(m)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                      trendMonths === m
                        ? 'bg-primary text-on-primary border-primary'
                        : 'border-border-color text-tertiary hover:text-primary hover:border-border-color'
                    }`}
                  >
                    {m}M
                  </button>
                ))}
              </div>
            </div>
            {(!categoryTrendData || categoryTrendData.rows.length === 0) ? (
              <p className="text-sm text-secondary text-center py-10">Sin datos en este período</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={categoryTrendData.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis 
                    dataKey="month" 
                    tick={{ fontSize: 10, fill: 'var(--chart-text)' }} 
                    axisLine={false} 
                    tickLine={false}
                    tickFormatter={(v) => {
                      const [, m] = v.split('-')
                      return MONTHS_ES_SHORT[parseInt(m) - 1] || v
                    }}
                  />
                  <YAxis
                    tickFormatter={(v) => new Intl.NumberFormat('es-AR', { notation: 'compact' } as any).format(v)}
                    tick={{ fontSize: 10, fill: 'var(--chart-text)' }}
                    width={48}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', borderColor: 'var(--chart-tooltip-border)', color: 'var(--chart-tooltip-text)', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number, name: string) => v > 0 ? [formatCurrency(v), name] : [formatCurrency(v), name]}
                  />
                  <Legend 
                    wrapperStyle={{ fontSize: 10, paddingTop: 10 }}
                    formatter={(value) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>}
                  />
                  {categoryTrendData.categories.map((cat) => {
                    const monthHasData = categoryTrendData.rows.some(r => Number(r[cat.name] || 0) > 0)
                    if (!monthHasData) return null
                    return (
                      <Line
                        key={cat.name}
                        type="monotone"
                        dataKey={cat.name}
                        stroke={cat.color || '#9a9996'}
                        strokeWidth={2}
                        dot={{ r: 3, fill: cat.color || '#9a9996' }}
                        activeDot={{ r: 4 }}
                      />
                    )
                  })}
                </ComposedChart>
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
                    <p className="text-sm font-medium text-primary">{toUpperCase(exp.description)}</p>
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
