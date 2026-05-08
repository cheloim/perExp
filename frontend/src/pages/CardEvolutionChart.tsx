import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Line, ReferenceLine } from 'recharts'
import type { CardSummary } from '../types'
import { formatCurrency } from '../utils/format'

const COLORS = ['#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']
const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function addMonths(base: string, delta: number): string {
  const [y, m] = base.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMonth(v: string) {
  const [y, m] = String(v).split('-')
  return `${MONTH_NAMES[parseInt(m) - 1]} ${y.slice(2)}`
}

// Unique key per card (same logic as Dashboard panel)
const ckey = (c: CardSummary) => `${c.holder}|${c.card_name}`

// Short display label: prefer card_name; add bank if card_name clashes
function cardLabel(card: CardSummary, all: CardSummary[]): string {
  const sameName = all.filter(c => c.card_name === card.card_name)
  if (sameName.length === 1) return card.card_name
  return `${card.card_name} (${card.bank})`
}

interface Props {
  cardData: CardSummary[]
  activeCard: string | null
  filterMonth: string
}

export function CardEvolutionChart({ cardData, activeCard, filterMonth }: Props) {
  if (cardData.length === 0) return null

  const historyMonths = Array.from({ length: 4 }, (_, i) => addMonths(filterMonth, i - 3))
  const projMonths    = Array.from({ length: 2 }, (_, i) => addMonths(filterMonth, i + 1))

  const chartData = historyMonths.map((month) => {
    const point: Record<string, number | string | boolean> = { month, isFuture: false }
    let total = 0
    cardData.forEach((card) => {
      const entry = card.monthly?.find(m => m.month === month)
      if (entry) {
        point[ckey(card)] = entry.total
        total += entry.total
      }
    })
    point.total = total
    return point
  })

  const projections = projMonths.map((month, i) => {
    const point: Record<string, number | string | boolean> = { month, isFuture: true }
    let total = 0
    cardData.forEach((card) => {
      const vals = historyMonths
        .map(hm => card.monthly?.find(m => m.month === hm)?.total ?? null)
        .filter((v): v is number => v !== null)
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
      const proj = Math.round(avg * (1 + (i + 1) * 0.02))
      point[ckey(card)] = proj
      total += proj
    })
    point.total = Math.round(total)
    return point
  })

  const fullData = [...chartData, ...projections]

  return (
    <div className="card p-5">
      <h2 className="text-base font-semibold text-primary mb-4">
        Evolución por Tarjeta — 4 meses + proyección 2 meses
      </h2>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={fullData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-color)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--color-tertiary)' }} tickFormatter={fmtMonth} />
          <YAxis
            tickFormatter={(v) => new Intl.NumberFormat('es-AR', { notation: 'compact' } as any).format(v as number)}
            tick={{ fontSize: 11, fill: 'var(--color-tertiary)' }}
            width={55}
          />
          <Tooltip
            contentStyle={{ backgroundColor: 'var(--color-bg-color)', borderColor: 'var(--color-border-color)', color: 'var(--color-text-color)' }}
            itemStyle={{ color: 'var(--color-text-color)' }}
            formatter={(v: number, name: string) => {
              if (name === 'total') return [formatCurrency(v), 'Total']
              const card = cardData.find(c => ckey(c) === name)
              return [formatCurrency(v), card ? cardLabel(card, cardData) : name]
            }}
            labelFormatter={fmtMonth}
          />
          <ReferenceLine x={filterMonth} stroke="var(--color-border-color)" strokeDasharray="4 4" label={{ value: 'hoy', fill: 'var(--color-tertiary)', fontSize: 10 }} />
          <Line
            type="monotone" dataKey="total" name="total"
            stroke="#6366f1" strokeWidth={activeCard ? 1 : 3}
            strokeDasharray="6 3" dot={{ r: activeCard ? 2 : 4 }} connectNulls
            opacity={activeCard ? 0.2 : 1}
          />
          {cardData.slice(0, 6).map((card, idx) => {
            const k = ckey(card)
            return (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                name={k}
                stroke={COLORS[idx % COLORS.length]}
                strokeWidth={activeCard === k ? 3 : 2}
                dot={{ r: 3 }}
                connectNulls
                opacity={activeCard ? (activeCard === k ? 1 : 0.1) : 1}
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-3 flex-wrap">
        <span className="flex items-center gap-1.5 text-xs text-secondary">
          <span className="w-3 h-2 rounded-sm bg-indigo-500 inline-block" /> Total
        </span>
        {cardData.slice(0, 6).map((card, idx) => (
          <span key={ckey(card)} className="flex items-center gap-1.5 text-xs text-secondary">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
            {cardLabel(card, cardData)}
          </span>
        ))}
        <span className="ml-auto text-[10px] text-tertiary">--- proyección</span>
      </div>
    </div>
  )
}
