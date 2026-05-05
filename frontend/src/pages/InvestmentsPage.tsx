import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getInvestments,
  createInvestment,
  updateInvestment,
  updateInvestmentPrice,
  deleteInvestment,
  getSettings,
  syncIOL,
  syncPPI,
  deduplicateInvestments,
} from '../api/client'
import type { Investment, InvestmentCreate } from '../types'

const INVESTMENT_TYPES = [
  'Acción', 'Cedear', 'Bono', 'Letra', 'ON', 'FCI', 'Caución', 'Plazo Fijo', 'Otro',
]

const BROKERS = ['InvertirOnline', 'Portfolio Personal']

const TYPE_COLORS: Record<string, string> = {
  'Acción':       '#6366f1',
  'Cedear':       '#8b5cf6',
  'Bono':         '#3b82f6',
  'Letra':        '#06b6d4',
  'ON':           '#14b8a6',
  'FCI':          '#10b981',
  'Caución':      '#f59e0b',
  'Plazo Fijo':   '#f97316',
  'Otro':         '#94a3b8',
}

function fmt(amount: number, currency = 'ARS') {
  if (currency === 'USD')
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount)
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount)
}

function fmtPct(pct: number) {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

function PnlChip({ pnl, pnl_pct, currency }: { pnl: number | null; pnl_pct: number | null; currency: string }) {
  if (pnl === null) return <span className="text-zinc-500 text-xs">—</span>
  const pos = pnl >= 0
  return (
    <div className={`flex flex-col items-end gap-0.5`}>
      <span className={`text-sm font-semibold ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
        {pos ? '+' : ''}{fmt(pnl, currency)}
      </span>
      {pnl_pct !== null && (
        <span className={`text-xs ${pos ? 'text-emerald-500' : 'text-red-500'}`}>
          {fmtPct(pnl_pct)}
        </span>
      )}
    </div>
  )
}

function InlinePriceEdit({ inv, onSave }: { inv: Investment; onSave: (price: number | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(inv.current_price !== null ? String(inv.current_price) : '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    const parsed = val === '' ? null : parseFloat(val)
    onSave(isNaN(parsed as number) ? null : parsed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        className="w-28 bg-zinc-200 border border-brand-500 text-zinc-900 text-sm rounded px-2 py-1 focus:outline-none"
      />
    )
  }

  return (
    <button
      onClick={() => { setVal(inv.current_price !== null ? String(inv.current_price) : ''); setEditing(true) }}
      className="group flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
      title="Clic para editar precio"
    >
      {inv.current_price !== null ? fmt(inv.current_price, inv.currency) : <span className="text-zinc-500">— sin precio</span>}
      <span className="text-zinc-600 group-hover:text-zinc-400 text-xs">✏</span>
    </button>
  )
}

const EMPTY_FORM: InvestmentCreate = {
  ticker: '', name: '', type: 'Acción', broker: 'InvertirOnline',
  quantity: 0, avg_cost: 0, current_price: null, currency: 'ARS', notes: '',
}

function InvestmentModal({
  initial, onClose, onSave,
}: {
  initial?: Investment | null
  onClose: () => void
  onSave: (data: InvestmentCreate) => void
}) {
  const [form, setForm] = useState<InvestmentCreate>(
    initial
      ? {
          ticker:        initial.ticker,
          name:          initial.name,
          type:          initial.type   || 'Acción',
          broker:        initial.broker || 'InvertirOnline',
          quantity:      initial.quantity,
          avg_cost:      initial.avg_cost,
          current_price: initial.current_price,
          currency:      initial.currency || 'ARS',
          notes:         initial.notes,
        }
      : EMPTY_FORM,
  )

  const set = (k: keyof InvestmentCreate, v: unknown) =>
    setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative card w-full max-w-lg max-h-[90vh] overflow-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">{initial ? 'Editar inversión' : 'Nueva inversión'}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">✕</button>
        </div>

        {/* Broker + Type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">Broker</label>
            <select value={form.broker} onChange={e => set('broker', e.target.value)} className="w-full input">
              {BROKERS.map(b => <option key={b} value={b}>{b}</option>)}
              <option value="">Otro</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">Tipo</label>
            <select value={form.type} onChange={e => set('type', e.target.value)} className="w-full input">
              {INVESTMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Ticker + Name */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">Ticker</label>
            <input
              type="text"
              value={form.ticker}
              onChange={e => set('ticker', e.target.value.toUpperCase())}
              placeholder="GGAL"
              className="w-full input uppercase"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-zinc-600 mb-1">Nombre</label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Grupo Financiero Galicia"
              className="w-full input"
            />
          </div>
        </div>

        {/* Quantity + Currency */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-zinc-600 mb-1">Cantidad</label>
            <input
              type="number"
              value={form.quantity}
              onChange={e => set('quantity', parseFloat(e.target.value) || 0)}
              className="w-full input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">Moneda</label>
            <select value={form.currency} onChange={e => set('currency', e.target.value)} className="w-full input">
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        {/* Avg cost + Current price */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">Precio promedio</label>
            <input
              type="number"
              value={form.avg_cost}
              onChange={e => set('avg_cost', parseFloat(e.target.value) || 0)}
              className="w-full input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">Precio actual</label>
            <input
              type="number"
              value={form.current_price ?? ''}
              onChange={e => set('current_price', e.target.value === '' ? null : parseFloat(e.target.value))}
              placeholder="Opcional"
              className="w-full input"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-1">Notas</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="w-full input" rows={2} />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button onClick={() => onSave(form)} className="btn-primary flex-1">Guardar</button>
        </div>
      </div>
    </div>
  )
}

function EnvRow({ label, configured }: { label: string; configured: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <code className="text-xs text-zinc-600 font-mono">{label}</code>
      {configured
        ? <span className="text-xs text-emerald-400 font-medium">✓ configurado</span>
        : <span className="text-xs text-red-400 font-medium">✗ vacío</span>}
    </div>
  )
}

function CredentialsModal({ settings, onClose }: { settings: Record<string, string>; onClose: () => void }) {
  const iolOk = settings.iol_configured === 'true' || settings.iol_configured === true as any
  const ppiOk = settings.ppi_configured === 'true' || settings.ppi_configured === true as any

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative card w-full max-w-md p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">Configuración de brokers</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">✕</button>
        </div>

        <p className="text-sm text-zinc-400">
          Las credenciales se configuran en el archivo <code className="text-brand-400 font-mono text-xs">backend/.env</code>
        </p>

        <div className="bg-white rounded-xl p-4 space-y-1 border border-zinc-200">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">InvertirOnline</p>
          <EnvRow label="IOL_USERNAME" configured={iolOk} />
          <EnvRow label="IOL_PASSWORD" configured={iolOk} />
        </div>

        <div className="bg-white rounded-xl p-4 space-y-1 border border-zinc-200">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Portfolio Personal</p>
          <EnvRow label="PPI_API_KEY" configured={ppiOk} />
          <EnvRow label="PPI_API_SECRET" configured={ppiOk} />
        </div>

        <div className="bg-zinc-100 rounded-lg p-3 text-xs text-zinc-400 font-mono space-y-0.5">
          <p className="text-zinc-500 mb-1"># backend/.env</p>
          <p>IOL_USERNAME=tu@email.com</p>
          <p>IOL_PASSWORD=tu_contraseña</p>
          <p>PPI_API_KEY=tu_api_key</p>
          <p>PPI_API_SECRET=tu_api_secret</p>
        </div>

        <p className="text-[11px] text-zinc-600">Reiniciá el servidor backend después de editar el .env para que tome los cambios.</p>

        <button onClick={onClose} className="btn-secondary w-full">Cerrar</button>
      </div>
    </div>
  )
}

type SortField = 'name' | 'type' | 'broker' | 'cost_basis' | 'current_value' | 'pnl' | 'pnl_pct'

export default function InvestmentsPage() {
  const queryClient = useQueryClient()
  const [brokerFilter, setBrokerFilter] = useState<string | null>(null)
  const [editing, setEditing] = useState<Investment | null | undefined>(undefined)
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'current_value', dir: 'desc' })
  const [showCreds, setShowCreds] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const { data: settings = {} } = useQuery({ queryKey: ['settings'], queryFn: getSettings, staleTime: 60_000 })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['investments'] })

  const { data: investments = [], isLoading } = useQuery({
    queryKey: ['investments'],
    queryFn: () => getInvestments(),
  })

  const showSync = (text: string, ok: boolean) => {
    setSyncMsg({ text, ok })
    setTimeout(() => setSyncMsg(null), 4000)
  }

  const iolMut = useMutation({
    mutationFn: syncIOL,
    onSuccess: (r) => { invalidate(); showSync(`IOL: ${r.updated} actualizadas, ${r.created} nuevas`, true) },
    onError: (e: Error) => showSync(`IOL error: ${e.message}`, false),
  })
  const ppiMut = useMutation({
    mutationFn: syncPPI,
    onSuccess: (r) => { invalidate(); showSync(`PPI: ${r.updated} actualizadas, ${r.created} nuevas`, true) },
    onError: (e: Error) => showSync(`PPI error: ${e.message}`, false),
  })
  const dedupMut = useMutation({
    mutationFn: deduplicateInvestments,
    onSuccess: (r) => { invalidate(); showSync(`${r.removed} duplicados eliminados`, true) },
  })

  const createMut = useMutation({ mutationFn: createInvestment, onSuccess: () => { invalidate(); setEditing(undefined) } })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: InvestmentCreate }) => updateInvestment(id, data),
    onSuccess: () => { invalidate(); setEditing(undefined) },
  })
  const priceMut  = useMutation({
    mutationFn: ({ id, price }: { id: number; price: number | null }) => updateInvestmentPrice(id, price),
    onSuccess: invalidate,
  })
  const deleteMut = useMutation({ mutationFn: deleteInvestment, onSuccess: invalidate })

  const handleSave = (data: InvestmentCreate) => {
    if (editing && editing.id) updateMut.mutate({ id: editing.id, data })
    else createMut.mutate(data)
  }

  const visible = brokerFilter ? investments.filter(i => i.broker === brokerFilter) : investments

  const sorted = [...visible].sort((a, b) => {
    const av = a[sort.field as keyof Investment] ?? 0
    const bv = b[sort.field as keyof Investment] ?? 0
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
    return sort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
  })

  const toggleSort = (field: SortField) =>
    setSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' })

  // ── Aggregates ──────────────────────────────────────────────────────────────
  const arsHoldings = visible.filter(i => i.currency === 'ARS')
  const usdHoldings = visible.filter(i => i.currency === 'USD')

  const arsValue  = arsHoldings.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0)
  const usdValue  = usdHoldings.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0)
  const arsCost   = arsHoldings.reduce((s, i) => s + i.cost_basis, 0)
  const usdCost   = usdHoldings.reduce((s, i) => s + i.cost_basis, 0)
  const arsPnl    = arsValue - arsCost
  const usdPnl    = usdValue - usdCost

  // Allocation by type (based on value)
  const byType: Record<string, number> = {}
  for (const inv of visible) {
    const v = inv.current_value ?? inv.cost_basis
    byType[inv.type || 'Otro'] = (byType[inv.type || 'Otro'] ?? 0) + v
  }
  const totalValue = Object.values(byType).reduce((s, v) => s + v, 0)

  const brokers = [...new Set(investments.map(i => i.broker).filter(Boolean))]

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sort.field !== field) return <span className="ml-1 text-zinc-600">↕</span>
    return <span className="ml-1 text-brand-400">{sort.dir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-zinc-900">Inversiones</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Sync status toast */}
          {syncMsg && (
            <span className={`text-xs px-3 py-1.5 rounded-lg font-medium ${syncMsg.ok ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
              {syncMsg.text}
            </span>
          )}

          {/* IOL sync */}
          <div className="flex flex-col items-end">
            <button
              onClick={() => iolMut.mutate()}
              disabled={iolMut.isPending}
              title={!settings.iol_configured ? 'IOL_USERNAME / IOL_PASSWORD no configurados en .env' : ''}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50 ${
                settings.iol_configured
                  ? 'border-zinc-300 text-zinc-600 hover:text-zinc-900 hover:border-zinc-500'
                  : 'border-zinc-300 text-zinc-600 cursor-not-allowed'
              }`}
            >
              {iolMut.isPending ? <span className="animate-spin inline-block">↻</span> : '↻'}
              IOL
              {!settings.iol_configured && <span className="text-yellow-500 text-xs">⚠</span>}
            </button>
            {settings.iol_last_sync && (
              <span className="text-[10px] text-zinc-600 mt-0.5">
                {new Date(settings.iol_last_sync).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
              </span>
            )}
          </div>

          {/* PPI sync */}
          <div className="flex flex-col items-end">
            <button
              onClick={() => ppiMut.mutate()}
              disabled={ppiMut.isPending}
              title={!settings.ppi_configured ? 'PPI_API_KEY / PPI_API_SECRET no configurados en .env' : ''}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50 ${
                settings.ppi_configured
                  ? 'border-zinc-300 text-zinc-600 hover:text-zinc-900 hover:border-zinc-500'
                  : 'border-zinc-300 text-zinc-600 cursor-not-allowed'
              }`}
            >
              {ppiMut.isPending ? <span className="animate-spin inline-block">↻</span> : '↻'}
              PPI
              {!settings.ppi_configured && <span className="text-yellow-500 text-xs">⚠</span>}
            </button>
            {settings.ppi_last_sync && (
              <span className="text-[10px] text-zinc-600 mt-0.5">
                {new Date(settings.ppi_last_sync).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
              </span>
            )}
          </div>

          <button
            onClick={() => dedupMut.mutate()}
            disabled={dedupMut.isPending}
            className="text-sm px-3 py-1.5 rounded-lg border border-zinc-300 text-zinc-400 hover:text-zinc-700 hover:border-zinc-600 disabled:opacity-50 transition-all"
            title="Eliminar duplicados"
          >
            {dedupMut.isPending ? '...' : '⊘'}
          </button>

          <button
            onClick={() => setShowCreds(true)}
            className="text-sm px-3 py-1.5 rounded-lg border border-zinc-300 text-zinc-400 hover:text-zinc-700 hover:border-zinc-600 transition-all"
            title="Configurar credenciales"
          >
            ⚙
          </button>

          <button onClick={() => setEditing(null)} className="btn-primary flex items-center gap-2 text-sm">
            <span className="text-lg leading-none">+</span>
            Nueva
          </button>
        </div>
      </div>

      {/* Broker tabs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setBrokerFilter(null)}
          className={`text-sm px-4 py-1.5 rounded-lg border transition-all ${!brokerFilter ? 'bg-zinc-200 border-zinc-600 text-zinc-900' : 'border-zinc-300 text-zinc-400 hover:text-zinc-700'}`}
        >
          Todos
        </button>
        {brokers.map(b => (
          <button
            key={b}
            onClick={() => setBrokerFilter(brokerFilter === b ? null : b)}
            className={`text-sm px-4 py-1.5 rounded-lg border transition-all ${brokerFilter === b ? 'bg-zinc-200 border-zinc-600 text-zinc-900' : 'border-zinc-300 text-zinc-400 hover:text-zinc-700'}`}
          >
            {b}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-zinc-400 mb-1">Valor ARS</p>
          <p className="text-xl font-bold text-zinc-900">{fmt(arsValue)}</p>
          <p className={`text-xs mt-1 font-medium ${arsPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {arsPnl >= 0 ? '+' : ''}{fmt(arsPnl)} P&L
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-zinc-400 mb-1">Valor USD</p>
          <p className="text-xl font-bold text-zinc-900">{fmt(usdValue, 'USD')}</p>
          <p className={`text-xs mt-1 font-medium ${usdPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {usdPnl >= 0 ? '+' : ''}{fmt(usdPnl, 'USD')} P&L
          </p>
        </div>
        <div className="card p-4 col-span-2">
          <p className="text-xs text-zinc-400 mb-2">Composición</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(byType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, val]) => {
                const pct = totalValue > 0 ? (val / totalValue) * 100 : 0
                return (
                  <div key={type} className="flex items-center gap-1 text-xs">
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: TYPE_COLORS[type] || '#94a3b8' }} />
                    <span className="text-zinc-600">{type}</span>
                    <span className="text-zinc-500">{pct.toFixed(0)}%</span>
                  </div>
                )
              })}
          </div>
          {/* Mini bar */}
          {totalValue > 0 && (
            <div className="flex h-2 rounded-full overflow-hidden mt-2 gap-px">
              {Object.entries(byType)
                .sort((a, b) => b[1] - a[1])
                .map(([type, val]) => (
                  <div
                    key={type}
                    style={{ width: `${(val / totalValue) * 100}%`, backgroundColor: TYPE_COLORS[type] || '#94a3b8' }}
                    title={`${type}: ${fmt(val)}`}
                  />
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Holdings table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white border-b border-zinc-200">
              <tr>
                <th className="px-4 py-3 text-left text-zinc-400 font-medium cursor-pointer hover:text-zinc-900 whitespace-nowrap" onClick={() => toggleSort('name')}>
                  Activo <SortIcon field="name" />
                </th>
                <th className="px-4 py-3 text-left text-zinc-400 font-medium cursor-pointer hover:text-zinc-900" onClick={() => toggleSort('type')}>
                  Tipo <SortIcon field="type" />
                </th>
                <th className="px-4 py-3 text-left text-zinc-400 font-medium cursor-pointer hover:text-zinc-900" onClick={() => toggleSort('broker')}>
                  Broker <SortIcon field="broker" />
                </th>
                <th className="px-4 py-3 text-right text-zinc-400 font-medium cursor-pointer hover:text-zinc-900 whitespace-nowrap" onClick={() => toggleSort('cost_basis')}>
                  Costo total <SortIcon field="cost_basis" />
                </th>
                <th className="px-4 py-3 text-right text-zinc-400 font-medium whitespace-nowrap">
                  Precio actual
                </th>
                <th className="px-4 py-3 text-right text-zinc-400 font-medium cursor-pointer hover:text-zinc-900 whitespace-nowrap" onClick={() => toggleSort('current_value')}>
                  Valor actual <SortIcon field="current_value" />
                </th>
                <th className="px-4 py-3 text-right text-zinc-400 font-medium cursor-pointer hover:text-zinc-900" onClick={() => toggleSort('pnl')}>
                  P&L <SortIcon field="pnl" />
                </th>
                <th className="px-4 py-3 text-center text-zinc-400 font-medium">Acc.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {isLoading ? (
                <tr><td colSpan={8} className="py-10 text-center text-zinc-500">Cargando...</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-zinc-500">Sin inversiones registradas</td></tr>
              ) : (
                sorted.map(inv => (
                  <tr key={inv.id} className="hover:bg-zinc-100/30 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        {inv.ticker && (
                          <span className="text-xs font-bold font-mono text-brand-400 mr-2">{inv.ticker}</span>
                        )}
                        <span className="text-zinc-900 font-medium">{inv.name || '—'}</span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {inv.quantity} unidades · P.avg {fmt(inv.avg_cost, inv.currency)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor: (TYPE_COLORS[inv.type] || '#94a3b8') + '20',
                          color: TYPE_COLORS[inv.type] || '#94a3b8',
                        }}
                      >
                        {inv.type || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">{inv.broker || '—'}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmt(inv.cost_basis, inv.currency)}</td>
                    <td className="px-4 py-3 text-right">
                      <InlinePriceEdit
                        inv={inv}
                        onSave={price => priceMut.mutate({ id: inv.id, price })}
                      />
                      {inv.updated_at && inv.current_price !== null && (
                        <div className="text-[10px] text-zinc-600 mt-0.5">
                          {new Date(inv.updated_at).toLocaleDateString('es-AR')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-900">
                      {inv.current_value !== null ? fmt(inv.current_value, inv.currency) : <span className="text-zinc-500 font-normal">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <PnlChip pnl={inv.pnl} pnl_pct={inv.pnl_pct} currency={inv.currency} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => setEditing(inv)} className="text-brand-400 hover:text-brand-300 mr-3">✏️</button>
                      <button
                        onClick={() => { if (confirm('¿Eliminar esta inversión?')) deleteMut.mutate(inv.id) }}
                        className="text-red-400 hover:text-red-600"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {sorted.length > 0 && (
          <div className="px-4 py-2 border-t border-zinc-200 text-xs text-zinc-500 text-right">
            {sorted.length} posiciones
          </div>
        )}
      </div>

      {editing !== undefined && (
        <InvestmentModal
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSave={handleSave}
        />
      )}

      {showCreds && <CredentialsModal settings={settings} onClose={() => setShowCreds(false)} />}
    </div>
  )
}
