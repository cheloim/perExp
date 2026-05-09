import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  getInstallmentsDashboard,
  getInstallmentsMonthlyLoad,
  getScheduledExpenses,
  executeScheduledExpense,
  cancelScheduledExpense,
} from '../api/client'
import type { InstallmentGroup } from '../types'
import { ConfirmDialog } from '../components/ConfirmDialog'

function formatCurrency(amount: number, currency = 'ARS') {
  if (currency === 'USD')
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(amount)
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount)
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  return `${d}-${m}-${y}`
}

const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

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

const CARD_GRADIENTS = [
  'from-indigo-600 to-purple-700',
  'from-emerald-600 to-teal-700',
  'from-orange-600 to-red-700',
  'from-pink-600 to-rose-700',
  'from-cyan-600 to-blue-700',
  'from-amber-600 to-yellow-700',
]

interface CardEntry {
  key: string
  card: string
  bank: string
  person: string
  pendingTotal: number
  currency: string
}

function InstallmentCard({
  entry, active, onClick, index,
}: {
  entry: CardEntry; active: boolean; onClick: () => void; index: number
}) {
  const network = detectNetwork(entry.card)
  const color = CARD_GRADIENTS[index % CARD_GRADIENTS.length]

  return (
    <div
      onClick={onClick}
      className={`relative rounded-2xl p-4 bg-gradient-to-br ${color} cursor-pointer transition-all duration-200 hover:scale-[1.02] shadow-lg ${active ? 'ring-2 ring-white/60 scale-[1.02]' : 'opacity-85 hover:opacity-100'}`}
      style={{ minHeight: 130 }}
    >
      <div className="flex justify-between items-start">
        <div>
          <p className="text-white/70 text-[10px] font-medium tracking-widest uppercase">{entry.bank || 'Banco'}</p>
          <p className="text-white text-xs font-bold tracking-wide">{entry.card}</p>
        </div>
        <CardNetworkLogo network={network} />
      </div>

      <div className="mt-3 mb-1 w-7 h-5 rounded-sm bg-yellow-300/80 border border-yellow-400/60 flex items-center justify-center">
        <div className="w-5 h-3 rounded-sm border border-yellow-500/50 grid grid-cols-2 gap-px p-px">
          <div className="bg-yellow-500/30 rounded-sm" /><div className="bg-yellow-500/30 rounded-sm" />
          <div className="bg-yellow-500/30 rounded-sm" /><div className="bg-yellow-500/30 rounded-sm" />
        </div>
      </div>

      <p className="text-white text-sm font-bold">💳 Tarjeta</p>
      <div className="mt-1">
        <p className="text-white/60 text-[10px]">Cuotas pendientes</p>
        <p className="text-white font-bold text-base leading-tight">{formatCurrency(entry.pendingTotal, entry.currency)}</p>
      </div>
    </div>
  )
}

export default function InstallmentsPage() {
  const queryClient = useQueryClient()
  const [bankFilter, setBankFilter] = useState<string | null>(null)
  const [activeCardKey, setActiveCardKey] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState<InstallmentGroup | null>(null)
  const [showScheduledModal, setShowScheduledModal] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState<number | null>(null)

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['installments'],
    queryFn: getInstallmentsDashboard,
    staleTime: 60_000,
  })

  const { data: monthlyLoad = [] } = useQuery({
    queryKey: ['installments-monthly-load'],
    queryFn: getInstallmentsMonthlyLoad,
    staleTime: 60_000,
  })

  const { data: scheduledForGroup = [] } = useQuery({
    queryKey: ['scheduled-expenses', selectedGroup?.installment_group_id],
    queryFn: () => getScheduledExpenses({
      installment_group_id: selectedGroup?.installment_group_id,
      status: 'PENDING'
    }),
    enabled: !!selectedGroup,
  })

  const executeMutation = useMutation({
    mutationFn: executeScheduledExpense,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] })
      queryClient.invalidateQueries({ queryKey: ['scheduled-expenses'] })
    }
  })

  const cancelMutation = useMutation({
    mutationFn: cancelScheduledExpense,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] })
      queryClient.invalidateQueries({ queryKey: ['scheduled-expenses'] })
    }
  })

  // Summary stats
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const activeGroups = groups.filter(g => g.remaining_installments > 0)

  const totalPending = activeGroups.reduce((s, g) => s + g.installment_amount * g.remaining_installments, 0)

  // Get current month data from monthlyLoad (includes actual paid installments)
  const currentMonthData = monthlyLoad.find(e => e.month === currentMonth)
  const currentMonthTotal = currentMonthData?.total ?? 0
  const currentMonthCount = currentMonthData?.count ?? 0

  // Build card entries — group by bank+person only (card name varies by import)
  const cardMap = new Map<string, CardEntry>()
  for (const g of activeGroups) {
    const key = `${g.bank}|${g.person}`
    if (!cardMap.has(key)) {
      cardMap.set(key, { key, card: g.card, bank: g.bank, person: g.person, pendingTotal: 0, currency: g.currency })
    }
    cardMap.get(key)!.pendingTotal += g.installment_amount * g.remaining_installments
  }
  const cardEntries = Array.from(cardMap.values())

  // Filter chips sources
  const banks = [...new Set(groups.map(g => g.bank).filter(Boolean))].sort()

  // Active card for filtering
  const activeCard = activeCardKey ? cardEntries.find(c => c.key === activeCardKey) : null

  // Apply filters to group list
  const filtered = groups.filter(g => {
    if (!showCompleted && g.remaining_installments === 0) return false
    if (bankFilter && g.bank !== bankFilter) return false
    if (activeCard && (`${g.bank}|${g.person}`) !== activeCard.key) return false
    return true
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-4">💳</p>
        <h2 className="text-lg font-semibold text-primary">Sin compras en cuotas</h2>
        <p className="text-sm text-tertiary mt-1">Importá extractos con cuotas para ver la proyección.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4">
          <p className="text-xs text-tertiary mb-1">Este mes</p>
          <p className="text-2xl font-bold text-success">{currentMonthCount}</p>
          <p className="text-xs text-tertiary">{formatCurrency(currentMonthTotal)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-tertiary mb-1">Total pendiente</p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(totalPending)}</p>
          <p className="text-xs text-tertiary">{activeGroups.length} grupos</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left — chart + list */}
        <div className="xl:col-span-2 space-y-5">
          {/* Monthly load chart */}
          <div className="card p-5">
            <h2 className="text-base font-semibold text-primary mb-1">Carga mensual en cuotas</h2>
            <p className="text-xs text-tertiary mb-4">Últimos 3 meses (real) + próximos 3 meses (proyección)</p>
            {(() => {
              const currentEntry = monthlyLoad.find(e => e.is_current)
              const currentTotal = currentEntry?.total ?? 0
              return (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={monthlyLoad} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: '#71717a' }}
                      tickFormatter={(v: string) => {
                        const [y, m] = v.split('-')
                        return `${MONTHS_ES[parseInt(m) - 1]} ${y.slice(2)}`
                      }}
                    />
                    <YAxis
                      tickFormatter={(v) => new Intl.NumberFormat('es-AR', { notation: 'compact' } as any).format(v)}
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      width={52}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e4e4e7', color: '#18181b', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.10)' }}
                      labelStyle={{ fontWeight: 600, color: '#18181b', marginBottom: 4 }}
                      itemStyle={{ color: '#3f3f46' }}
                      formatter={(v: number, _: string, props: any) => {
                        const entry = props.payload
                        const kind = entry?.is_current ? 'Mes actual' : entry?.is_past ? 'Pagado' : 'Proyectado'
                        if (!entry?.is_current && currentTotal > 0) {
                          const pct = ((v - currentTotal) / currentTotal) * 100
                          const sign = pct > 0 ? '+' : ''
                          const color = pct > 0 ? '#ef4444' : '#22c55e'
                          return [
                            <span style={{ color: '#18181b' }}>{formatCurrency(v)} <span style={{ color, fontWeight: 700 }}>({sign}{pct.toFixed(0)}%)</span></span>,
                            kind,
                          ]
                        }
                        return [formatCurrency(v), kind]
                      }}
                      labelFormatter={(l: string) => {
                        const [y, m] = l.split('-')
                        return `${MONTHS_ES[parseInt(m) - 1]} ${y}`
                      }}
                    />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                      {monthlyLoad.map((e) => {
                        let fill = '#3b82f6'
                        if (e.is_current) fill = '#22c55e'
                        else if (e.is_past) fill = '#f59e0b'
                        else if (currentTotal > 0) fill = e.total > currentTotal ? '#ef4444' : '#3b82f6'
                        return <Cell key={e.month} fill={fill} fillOpacity={e.is_past ? 0.75 : 1} />
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
            })()}
            <div className="flex items-center gap-4 mt-3 justify-center">
              <span className="flex items-center gap-1.5 text-[10px] text-tertiary"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#f59e0b' }} />Real pagado</span>
              <span className="flex items-center gap-1.5 text-[10px] text-tertiary"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#22c55e' }} />Mes actual</span>
              <span className="flex items-center gap-1.5 text-[10px] text-tertiary"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#6366f1' }} />Proyectado</span>
              <span className="flex items-center gap-1.5 text-[10px] text-tertiary"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#ef4444' }} />Mayor gasto</span>
              <span className="flex items-center gap-1.5 text-[10px] text-tertiary"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#4ade80' }} />Menor gasto</span>
            </div>
          </div>

          {/* Groups list */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-border-color flex items-center justify-between">
              <h2 className="text-base font-semibold text-primary">
                Compras en cuotas
                <span className="ml-2 text-xs text-secondary">{filtered.length} registros</span>
              </h2>
              <button
                onClick={() => setShowCompleted(v => !v)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${showCompleted ? 'bg-primary text-on-primary' : 'border-border-color text-tertiary hover:text-secondary'}`}
              >
                {showCompleted ? 'Ocultar completadas' : 'Mostrar completadas'}
              </button>
            </div>

            {filtered.length === 0 ? (
              <p className="text-secondary text-sm text-center py-10">Sin resultados para los filtros seleccionados</p>
            ) : (
              <div className="divide-y divide-border-color">
                {filtered.map((g) => {
                  const pct = g.installment_total > 0 ? (g.installments_paid / g.installment_total) * 100 : 0
                  const done = g.remaining_installments === 0
                  return (
                    <div key={g.installment_group_id} className="px-5 py-3 hover:bg-primary/5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
                            style={{ backgroundColor: g.category_color || '#6366f1' }}
                          />
                          <div className="min-w-0">
                            <p className={`text-sm font-medium ${done ? 'text-secondary' : 'text-primary'} truncate`}>
                              {g.description}
                              {g.remaining_installments > 0 && (
                                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                                  {g.remaining_installments} programada{g.remaining_installments > 1 ? 's' : ''}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-secondary mt-0.5">
                              {g.bank}{g.card ? ` · ${g.card}` : ''}
                              {g.next_date && !done && <> · próxima: {formatDate(g.next_date)}</>}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                          <div>
                            <p className={`text-sm font-semibold ${done ? 'text-secondary' : 'text-primary'}`}>
                              {formatCurrency(g.installment_amount, g.currency)}
                            </p>
                            <p className="text-xs text-secondary">
                              {done
                                ? <span className="text-success">✓ Completada</span>
                                : <>{g.remaining_installments} restante{g.remaining_installments !== 1 ? 's' : ''}</>
                              }
                            </p>
                          </div>
                          {g.remaining_installments > 0 && (
                            <button
                              onClick={() => {
                                setSelectedGroup(g)
                                setShowScheduledModal(true)
                              }}
                              className="text-xs text-secondary hover:text-primary underline"
                            >
                              Gestionar
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-base-alt rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: g.category_color || '#6366f1',
                            }}
                          />
                        </div>
                        <span className="text-[10px] text-secondary flex-shrink-0">
                          {g.installments_paid}/{g.installment_total}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right — filter chips + cards */}
        <div className="xl:col-span-1">
          <div className="card p-5 sticky top-24 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-primary">Tarjetas</h2>
              {(bankFilter || activeCardKey) && (
                <button
                  onClick={() => { setBankFilter(null); setActiveCardKey(null) }}
                  className="text-xs text-secondary hover:text-tertiary"
                >
                  Limpiar
                </button>
              )}
            </div>

            {/* Bank filter */}
            {banks.length > 1 && (
              <div>
                <p className="text-[10px] text-secondary uppercase tracking-wide mb-1.5">Banco</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setBankFilter(null)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${!bankFilter ? 'bg-primary text-on-primary' : 'border-border-color text-tertiary hover:text-secondary'}`}
                  >
                    Todos
                  </button>
                  {banks.map(b => (
                    <button
                      key={b}
                      onClick={() => setBankFilter(bankFilter === b ? null : b)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-all ${bankFilter === b ? 'bg-primary text-on-primary' : 'border-border-color text-tertiary hover:text-secondary'}`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Card visualizations */}
            <div className="space-y-3 pt-1">
              {cardEntries
                .filter(c => !bankFilter || c.bank === bankFilter)
                .map((entry, idx) => (
                  <InstallmentCard
                    key={entry.key}
                    entry={entry}
                    active={activeCardKey === entry.key}
                    onClick={() => setActiveCardKey(activeCardKey === entry.key ? null : entry.key)}
                    index={idx}
                  />
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modal de gestión de cuotas programadas */}
      {showScheduledModal && selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowScheduledModal(false)}>
          <div className="card p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-primary">
                Cuotas programadas: {selectedGroup.description}
              </h2>
              <button onClick={() => setShowScheduledModal(false)} className="text-secondary hover:text-primary">✕</button>
            </div>

            <div className="space-y-2">
              {scheduledForGroup.length === 0 ? (
                <p className="text-secondary text-sm text-center py-4">No hay cuotas programadas</p>
              ) : (
                scheduledForGroup.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 border border-border-color rounded">
                    <div>
                      <p className="font-medium text-primary">
                        Cuota {s.installment_number}/{s.installment_total}
                      </p>
                      <p className="text-xs text-secondary">
                        {formatDate(s.scheduled_date)} · {formatCurrency(s.amount, s.currency)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => executeMutation.mutate(s.id)}
                        className="px-3 py-1.5 text-xs rounded bg-primary text-on-primary hover:brightness-110"
                        disabled={executeMutation.isPending}
                      >
                        Ejecutar ahora
                      </button>
                      <button
                        onClick={() => setCancelConfirm(s.id)}
                        className="px-3 py-1.5 text-xs rounded border border-border-color text-secondary hover:bg-base-alt"
                        disabled={cancelMutation.isPending}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation dialog for canceling installment */}
      <ConfirmDialog
        isOpen={cancelConfirm !== null}
        title="Cancelar cuota programada"
        message="¿Estás seguro que querés cancelar esta cuota? Esta acción no se puede deshacer."
        confirmLabel="Cancelar cuota"
        cancelLabel="Volver"
        variant="danger"
        onConfirm={() => {
          if (cancelConfirm !== null) {
            cancelMutation.mutate(cancelConfirm)
            setCancelConfirm(null)
          }
        }}
        onCancel={() => setCancelConfirm(null)}
      />
    </div>
  )
}
