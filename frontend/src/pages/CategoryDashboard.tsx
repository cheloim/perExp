import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { getDashboard, getExpenses, getCategoryTrend, getTopMerchants } from '../api/client'
import type { TopMerchant, CategorySummary } from '../types'

function formatCurrency(amount: number, currency = 'ARS') {
  if (currency === 'USD')
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount)
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

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function MonthSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y, m] = value.split('-').map(Number)
  const shift = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1)
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return (
    <div className="flex items-center gap-0.5 bg-base-alt border border-border-color rounded-lg px-1 py-1">
      <button onClick={() => shift(-1)} className="px-2 py-0.5 text-tertiary hover:text-primary rounded transition-colors">◀</button>
      <span className="text-primary text-sm font-medium px-3 min-w-[130px] text-center select-none">
        {MONTHS_ES[m - 1]} {y}
      </span>
      <button onClick={() => shift(1)} className="px-2 py-0.5 text-tertiary hover:text-primary rounded transition-colors">▶</button>
    </div>
  )
}

interface GroupedCategory {
  name: string
  color: string
  total: number
  count: number
  isParent: boolean
  children: CategorySummary[]
  self?: CategorySummary  // the parent's own summary entry (if it appears as a leaf too)
}

function groupByParent(cats: CategorySummary[]): GroupedCategory[] {
  const parentMap = new Map<string, GroupedCategory>()
  const result: GroupedCategory[] = []

  // First pass: create parent groups
  for (const cat of cats) {
    if (cat.parent_name) {
      if (!parentMap.has(cat.parent_name)) {
        parentMap.set(cat.parent_name, {
          name: cat.parent_name,
          color: cat.parent_color ?? '#6b7280',
          total: 0,
          count: 0,
          isParent: true,
          children: [],
        })
      }
      const group = parentMap.get(cat.parent_name)!
      group.total += cat.total
      group.count += cat.count
      group.children.push(cat)
    } else {
      result.push({
        name: cat.category_name,
        color: cat.category_color,
        total: cat.total,
        count: cat.count,
        isParent: false,
        children: [],
        self: cat,
      })
    }
  }

  // Sort children within each parent by total desc
  for (const g of parentMap.values()) {
    g.children.sort((a, b) => b.total - a.total)
    result.push(g)
  }

  return result.sort((a, b) => b.total - a.total)
}

export default function CategoryDashboard() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [month, setMonth] = useState(currentMonth)
  const [selectedCategoryName, setSelectedCategoryName] = useState<string | null>(null)
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())

  const { data: summary, isLoading } = useQuery({
    queryKey: ['dashboard', 'cat-dash', month],
    queryFn: () => getDashboard({ month }),
    placeholderData: (prev) => prev,
  })

  const { data: trendData } = useQuery({
    queryKey: ['category-trend'],
    queryFn: () => getCategoryTrend(4),
    staleTime: 60_000,
  })

  const [merchantTab, setMerchantTab] = useState<'amount' | 'count'>('amount')

  const { data: merchantsRaw = [] } = useQuery({
    queryKey: ['top-merchants', month],
    queryFn: () => getTopMerchants({ month, limit: 20 }),
    staleTime: 60_000,
  })

  const categories = summary?.by_category ?? []
  const grouped = groupByParent(categories)
  const grandTotal = categories.reduce((s, c) => s + c.total, 0)
  const maxGroupTotal = grouped.reduce((m, g) => Math.max(m, g.total), 0)

  // Resolve selected category to a CategorySummary for drilldown
  const activeCat = selectedCategoryName
    ? categories.find(c => c.category_name === selectedCategoryName) ?? null
    : null

  const merchants: TopMerchant[] = activeCat
    ? merchantsRaw.filter(m => m.category_name === activeCat.category_name)
    : merchantsRaw

  const sortedMerchants = [...merchants].sort((a, b) =>
    merchantTab === 'amount' ? b.total_amount - a.total_amount : b.count - a.count
  ).slice(0, 15)

  const maxMerchantVal = sortedMerchants.length > 0
    ? Math.max(...sortedMerchants.map(m => merchantTab === 'amount' ? m.total_amount : m.count))
    : 1

  const selectedCategoryId = activeCat?.category_id ?? undefined

  const { data: expenses = [], isLoading: expLoading } = useQuery({
    queryKey: ['expenses', 'cat-drill', selectedCategoryId, month],
    queryFn: () => getExpenses({ category_id: selectedCategoryId, month, limit: 300 }),
    enabled: selectedCategoryName !== null,
  })

  const displayTotal = activeCat ? activeCat.total : (summary?.total_amount ?? 0)
  const displayCount = activeCat ? activeCat.count : (summary?.total_expenses ?? 0)
  const displayAvg = displayCount > 0 ? displayTotal / displayCount : 0
  const sortedExpenses = [...expenses].sort((a, b) => b.amount - a.amount)

  const toggleParent = (name: string) => {
    setExpandedParents(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  const handleLegendClick = (name: string) => {
    setSelectedCategoryName(prev => prev === name ? null : name)
  }

  const visibleCategories = trendData?.categories ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-primary">Por Categoría</h1>
        <MonthSelector value={month} onChange={(v) => { setMonth(v); setSelectedCategoryName(null) }} />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-tertiary mb-1">{activeCat ? activeCat.category_name : 'Total'}</p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(displayTotal)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-tertiary mb-1">Transacciones</p>
          <p className="text-2xl font-bold text-primary">{displayCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-tertiary mb-1">Promedio</p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(displayAvg)}</p>
        </div>
      </div>

      {/* Grouped category bars */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-primary">Gastos por categoría</h2>
          {selectedCategoryName && (
            <button onClick={() => setSelectedCategoryName(null)} className="text-xs text-secondary hover:text-primary transition-colors">
              Limpiar selección
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : grouped.length === 0 ? (
          <p className="text-secondary text-sm text-center py-10">Sin datos</p>
        ) : (
          <div className="space-y-1">
            {grouped.map(group => {
              const pct = maxGroupTotal > 0 ? (group.total / maxGroupTotal) * 100 : 0
              const isExpanded = expandedParents.has(group.name)

              return (
                <div key={group.name}>
                  {/* Group row */}
                  <div
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all hover:bg-base-alt ${
                      !group.isParent && selectedCategoryName === group.name ? 'bg-base-alt/70 ring-1 ring-white/10' : ''
                    }`}
                    onClick={() => {
                      if (group.isParent) {
                        toggleParent(group.name)
                      } else {
                        setSelectedCategoryName(prev => prev === group.name ? null : group.name)
                      }
                    }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
                    <span className="text-sm text-primary font-medium w-36 truncate flex-shrink-0">{group.name}</span>
                    <div className="flex-1 h-2 bg-base-alt rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: group.color }} />
                    </div>
                    <span className="text-xs text-tertiary w-8 text-right flex-shrink-0">{group.count}</span>
                    <span className="text-sm font-semibold text-primary w-32 text-right flex-shrink-0">{formatCurrency(group.total)}</span>
                    {grandTotal > 0 && (
                      <span className="text-xs text-secondary w-10 text-right flex-shrink-0">
                        {((group.total / grandTotal) * 100).toFixed(0)}%
                      </span>
                    )}
                    {group.isParent && (
                      <span className="text-secondary text-xs flex-shrink-0 w-4">{isExpanded ? '▼' : '▶'}</span>
                    )}
                  </div>

                  {/* Children rows */}
                  {group.isParent && isExpanded && (
                    <div className="ml-5 space-y-0.5 mb-1">
                      {group.children.map(child => {
                        const childPct = maxGroupTotal > 0 ? (child.total / maxGroupTotal) * 100 : 0
                        const isSelected = selectedCategoryName === child.category_name
                        return (
                          <div
                            key={child.category_name}
                            onClick={() => setSelectedCategoryName(prev => prev === child.category_name ? null : child.category_name)}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all hover:bg-base-alt ${isSelected ? 'bg-base-alt/70 ring-1 ring-white/10' : ''}`}
                          >
                            <span className="w-2 h-2 rounded-full flex-shrink-0 opacity-80" style={{ backgroundColor: child.category_color }} />
                            <span className="text-xs text-secondary w-36 truncate flex-shrink-0">{child.category_name}</span>
                            <div className="flex-1 h-1.5 bg-base-alt rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${childPct}%`, backgroundColor: child.category_color }} />
                            </div>
                            <span className="text-xs text-secondary w-8 text-right flex-shrink-0">{child.count}</span>
                            <span className="text-xs font-medium text-secondary w-32 text-right flex-shrink-0">{formatCurrency(child.total)}</span>
                            {grandTotal > 0 && (
                              <span className="text-xs text-secondary w-10 text-right flex-shrink-0">
                                {((child.total / grandTotal) * 100).toFixed(0)}%
                              </span>
                            )}
                            <span className="w-4 flex-shrink-0" />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <p className="text-xs text-secondary mt-3 text-center">Hacé clic en una categoría para ver el detalle · clic en padre para expandir subcategorías</p>
      </div>

      {/* Line chart — 4-month trend per category */}
      <div className="card p-5">
        <h2 className="text-base font-semibold text-primary mb-4">Evolución — últimos 4 meses</h2>
        {!trendData ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : visibleCategories.length === 0 ? (
          <p className="text-secondary text-sm text-center py-12">Sin datos</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trendData.rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: '#a1a1aa' }}
                tickFormatter={(v: string) => {
                  const [y, m] = String(v).split('-')
                  const names = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
                  return `${names[parseInt(m)-1]} ${y.slice(2)}`
                }}
              />
              <YAxis
                tickFormatter={(v) => new Intl.NumberFormat('es-AR', { notation: 'compact' } as any).format(v)}
                tick={{ fontSize: 11, fill: '#a1a1aa' }}
                width={52}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--color-chart-tooltip-bg)', borderColor: 'var(--color-chart-tooltip-border)', color: '#f4f4f5' }}
                itemStyle={{ color: '#f4f4f5' }}
                formatter={(v: number, name: string) => [formatCurrency(v), name]}
                labelFormatter={(l: string) => {
                  const [y, m] = l.split('-')
                  const names = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
                  return `${names[parseInt(m)-1]} ${y}`
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                iconType="circle"
                iconSize={8}
                onClick={(e) => handleLegendClick(e.value as string)}
                formatter={(value: string) => (
                  <span className={`cursor-pointer text-xs ${selectedCategoryName && selectedCategoryName !== value ? 'opacity-40' : 'text-secondary'}`}>
                    {value}
                  </span>
                )}
              />
              {visibleCategories.map(cat => (
                <Line
                  key={cat.name}
                  type="monotone"
                  dataKey={cat.name}
                  stroke={cat.color || '#94a3b8'}
                  strokeWidth={selectedCategoryName === cat.name ? 3 : 2}
                  strokeOpacity={selectedCategoryName && selectedCategoryName !== cat.name ? 0.2 : 1}
                  dot={{ r: 3, fill: cat.color || '#94a3b8' }}
                  activeDot={{ r: 5, onClick: () => handleLegendClick(cat.name) }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top Comercios */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-primary">
            Top Comercios
            {activeCat && <span className="ml-2 text-xs text-secondary">— {activeCat.category_name}</span>}
          </h2>
          <div className="flex rounded-lg overflow-hidden border border-border-color">
            <button
              onClick={() => setMerchantTab('amount')}
              className={`px-3 py-1 text-xs transition-colors ${merchantTab === 'amount' ? 'bg-primary text-on-primary font-medium' : 'text-tertiary hover:text-primary'}`}
            >
              Por monto
            </button>
            <button
              onClick={() => setMerchantTab('count')}
              className={`px-3 py-1 text-xs transition-colors border-l border-border-color ${merchantTab === 'count' ? 'bg-primary text-on-primary font-medium' : 'text-tertiary hover:text-primary'}`}
            >
              Por frecuencia
            </button>
          </div>
        </div>

        {sortedMerchants.length === 0 ? (
          <p className="text-secondary text-sm text-center py-8">Sin datos</p>
        ) : (
          <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
            {sortedMerchants.map((m, i) => {
              const val = merchantTab === 'amount' ? m.total_amount : m.count
              const pct = maxMerchantVal > 0 ? (val / maxMerchantVal) * 100 : 0
              return (
                <div key={i} className="flex items-center gap-2 group">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.category_color || '#6366f1' }} />
                  <span className="text-xs text-secondary w-40 truncate flex-shrink-0" title={m.description}>{m.description}</span>
                  <div className="flex-1 h-1.5 bg-base-alt rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: m.category_color || '#6366f1' }} />
                  </div>
                  <span className="text-xs text-tertiary flex-shrink-0 w-28 text-right">
                    {merchantTab === 'amount'
                      ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(m.total_amount)
                      : `${m.count}×`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Expense drilldown */}
      {selectedCategoryName !== null && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-border-color flex items-center justify-between">
            <h2 className="text-base font-semibold text-primary">
              {activeCat
                ? <><span style={{ color: activeCat.category_color }}>{activeCat.category_name}</span> — mayor a menor</>
                : 'Gastos'}
            </h2>
            <span className="text-xs text-secondary">{sortedExpenses.length} registros</span>
          </div>
          {expLoading ? (
            <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
          ) : sortedExpenses.length === 0 ? (
            <p className="text-secondary text-sm text-center py-10">Sin gastos en este período</p>
          ) : (
            <div className="divide-y divide-border-color max-h-[480px] overflow-y-auto">
              {sortedExpenses.map((exp) => (
                <div key={exp.id} className="flex items-center justify-between px-5 py-3 hover:bg-base-alt/50">
                  <div>
                    <p className="text-sm font-medium text-primary">{exp.description}</p>
                    <p className="text-xs text-secondary">
                      {formatDate(exp.date)}
                      {exp.person ? ` · ${exp.person}` : ''}
                      {exp.bank ? ` · ${exp.bank}` : ''}
                    </p>
                  </div>
                  <span className={`text-sm font-semibold ml-4 whitespace-nowrap ${exp.amount < 0 ? 'text-success' : 'text-primary'}`}>
                    {formatCurrency(exp.amount, exp.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
