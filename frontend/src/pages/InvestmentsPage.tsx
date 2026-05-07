import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getInvestments,
  createInvestment,
  updateInvestment,
  updateInvestmentPrice,
  deleteInvestment,
  getSettings,
  syncIOL, syncPPI,
  refreshManualPrices,
  getUsdRate,
  getCashBalances,
  getManualCashBalances,
  putManualCashBalance,
  deleteManualCashBalance,
  putSetting,
} from '../api/client'
import type { Investment, InvestmentCreate } from '../types'

// Parses "1.234,56" or "1234,56" or "1234.56" → 1234.56
function parseCurrency(s: string): number | null {
  const clean = s.trim()
  if (!clean) return null
  // Remove thousands separators: if both . and , present, dots are thousands
  let normalized: string
  if (clean.includes('.') && clean.includes(',')) {
    normalized = clean.replace(/\./g, '').replace(',', '.')
  } else if (clean.includes(',')) {
    // single comma → decimal separator (es-AR style)
    normalized = clean.replace(',', '.')
  } else {
    // only dots, no comma → dots are thousands separators (our formatter always uses . for thousands)
    normalized = clean.replace(/\./g, '')
  }
  const n = parseFloat(normalized)
  return isNaN(n) ? null : n
}

function formatCurrency(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Formats the raw string while typing: applies thousands separators preserving partial decimal
function formatWhileTyping(s: string): string {
  const clean = s.replace(/[^\d,]/g, '') // keep digits and comma
  const [intPart, ...rest] = clean.split(',')
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return rest.length > 0 ? `${intFormatted},${rest.join('')}` : intFormatted
}

function CurrencyInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
}) {
  const isEmpty = (v: number | null) => v === null || v === 0
  const [raw, setRaw] = useState(isEmpty(value) ? '' : formatCurrency(value!))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setRaw(isEmpty(value) ? '' : formatCurrency(value!))
  }, [value, focused])

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setFocused(true)
    // clear placeholder-like zeros so paste/type overwrites immediately
    if (isEmpty(value)) setRaw('')
    setTimeout(() => e.target.select(), 0)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value
    const formatted = formatWhileTyping(input)
    setRaw(formatted)
    onChange(parseCurrency(formatted))
  }

  const handleBlur = () => {
    setFocused(false)
    const parsed = parseCurrency(raw)
    onChange(parsed)
    setRaw(isEmpty(parsed) ? '' : formatCurrency(parsed!))
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      placeholder={placeholder ?? '0,00'}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className="w-full input"
    />
  )
}

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

function InvestmentModal({
  initial, onClose, onSave, defaultBroker, knownBrokers = [],
}: {
  initial?: Investment | null
  onClose: () => void
  onSave: (data: InvestmentCreate) => void
  defaultBroker?: string | null
  knownBrokers?: string[]
}) {
  const allBrokers = [...new Set([...BROKERS, ...knownBrokers])]
  const emptyForm: InvestmentCreate = {
    ticker: '', name: '', type: 'Acción',
    broker: defaultBroker || 'InvertirOnline',
    quantity: 0, avg_cost: 0, current_price: null, currency: 'ARS', notes: '',
  }
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
      : emptyForm,
  )

  const set = (k: keyof InvestmentCreate, v: unknown) =>
    setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative card w-full max-w-lg max-h-[90vh] overflow-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">{initial ? 'Editar inversión' : 'Nueva inversión'}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">✕</button>
        </div>

        {/* Broker + Type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">Broker</label>
            <select
              value={allBrokers.includes(form.broker ?? '') ? form.broker : '__custom__'}
              onChange={e => set('broker', e.target.value === '__custom__' ? '' : e.target.value)}
              className="w-full input"
            >
              {allBrokers.map(b => <option key={b} value={b}>{b}</option>)}
              <option value="__custom__">Otro…</option>
            </select>
            {!allBrokers.includes(form.broker ?? '') && (
              <input
                type="text"
                value={form.broker}
                onChange={e => set('broker', e.target.value)}
                placeholder="Nombre del broker"
                className="w-full input mt-1.5"
                autoFocus
              />
            )}
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
              onFocus={e => e.target.select()}
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
            <CurrencyInput
              value={form.avg_cost ?? null}
              onChange={v => set('avg_cost', v ?? 0)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">Precio actual</label>
            <CurrencyInput
              value={form.current_price ?? null}
              onChange={v => set('current_price', v)}
              placeholder="Opcional"
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

function CredentialsModal({ settings, onClose, onSaved }: {
  settings: Record<string, string>
  onClose: () => void
  onSaved: () => void
}) {
  const iolOk = settings.iol_configured === 'true' || (settings.iol_configured as any) === true
  const ppiOk = settings.ppi_configured === 'true' || (settings.ppi_configured as any) === true

  const [iolUser, setIolUser] = useState('')
  const [iolPass, setIolPass] = useState('')
  const [ppiKey,  setPpiKey]  = useState('')
  const [ppiSec,  setPpiSec]  = useState('')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const pairs: [string, string][] = []
      if (iolUser) pairs.push(['iol_username', iolUser])
      if (iolPass) pairs.push(['iol_password', iolPass])
      if (ppiKey)  pairs.push(['ppi_api_key',  ppiKey])
      if (ppiSec)  pairs.push(['ppi_api_secret', ppiSec])
      await Promise.all(pairs.map(([k, v]) => putSetting(k, v)))
      setSaved(true)
      setIolUser(''); setIolPass(''); setPpiKey(''); setPpiSec('')
      onSaved()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Error al guardar credenciales')
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = iolUser || iolPass || ppiKey || ppiSec

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative card w-full max-w-md p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">Configuración de brokers</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">✕</button>
        </div>

        {saved && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700 font-medium">
            ✓ Credenciales guardadas correctamente
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 font-medium">
            ✗ {error}
          </div>
        )}

        {/* IOL */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">InvertirOnline</p>
            <span className={`text-xs font-medium ${iolOk ? 'text-emerald-500' : 'text-zinc-400'}`}>
              {iolOk ? '✓ configurado' : '✗ sin credenciales'}
            </span>
          </div>
          <input
            type="email"
            value={iolUser}
            onChange={e => setIolUser(e.target.value)}
            placeholder={iolOk ? 'Usuario (dejar vacío para no cambiar)' : 'usuario@email.com'}
            className="w-full input text-sm"
            autoComplete="off"
          />
          <input
            type="password"
            value={iolPass}
            onChange={e => setIolPass(e.target.value)}
            placeholder={iolOk ? 'Contraseña (dejar vacío para no cambiar)' : 'Contraseña'}
            className="w-full input text-sm"
            autoComplete="new-password"
          />
        </div>

        {/* PPI */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Portfolio Personal</p>
            <span className={`text-xs font-medium ${ppiOk ? 'text-emerald-500' : 'text-zinc-400'}`}>
              {ppiOk ? '✓ configurado' : '✗ sin credenciales'}
            </span>
          </div>
          <input
            type="password"
            value={ppiKey}
            onChange={e => setPpiKey(e.target.value)}
            placeholder={ppiOk ? 'API Key (dejar vacío para no cambiar)' : 'API Key'}
            className="w-full input text-sm"
            autoComplete="new-password"
          />
          <input
            type="password"
            value={ppiSec}
            onChange={e => setPpiSec(e.target.value)}
            placeholder={ppiOk ? 'API Secret (dejar vacío para no cambiar)' : 'API Secret'}
            className="w-full input text-sm"
            autoComplete="new-password"
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1">Cerrar</button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ManualCashSection({
  knownBrokers, manualCash, onSave, onDelete,
}: {
  knownBrokers: string[]
  manualCash: Record<string, { ars: number | null; usd: number | null }>
  onSave: (broker: string, ars: number | null, usd: number | null) => void
  onDelete: (broker: string) => void
}) {
  const allBrokers = [...new Set([...Object.keys(manualCash), ...knownBrokers])]
  const [editing, setEditing] = useState<string | null>(null)
  const [editArs, setEditArs] = useState('')
  const [editUsd, setEditUsd] = useState('')

  const startEdit = (broker: string) => {
    const entry = manualCash[broker]
    setEditArs(entry?.ars !== null && entry?.ars !== undefined ? String(entry.ars) : '')
    setEditUsd(entry?.usd !== null && entry?.usd !== undefined ? String(entry.usd) : '')
    setEditing(broker)
  }

  const commitEdit = (broker: string) => {
    const ars = editArs === '' ? null : parseFloat(editArs)
    const usd = editUsd === '' ? null : parseFloat(editUsd)
    onSave(broker, isNaN(ars as number) ? null : ars, isNaN(usd as number) ? null : usd)
    setEditing(null)
  }

  if (allBrokers.length === 0) return null

  return (
    <>
      {allBrokers.map(broker => (
        <div key={broker} className="flex-shrink-0">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">{broker}</p>
            {editing === broker
              ? <button onClick={() => commitEdit(broker)} className="text-[10px] text-emerald-500 hover:text-emerald-700">✓</button>
              : <button onClick={() => startEdit(broker)} className="text-[10px] text-zinc-400 hover:text-zinc-600">✏</button>
            }
            <button onClick={() => onDelete(broker)} className="text-[10px] text-red-400 hover:text-red-600">✕</button>
          </div>
          {editing === broker ? (
            <div className="flex gap-2">
              <div>
                <p className="text-[10px] text-zinc-500">ARS</p>
                <input
                  type="number"
                  value={editArs}
                  onChange={e => setEditArs(e.target.value)}
                  placeholder="0"
                  autoFocus
                  className="w-28 bg-zinc-100 border border-brand-400 text-zinc-900 text-xs rounded px-2 py-1 focus:outline-none"
                />
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">USD</p>
                <input
                  type="number"
                  value={editUsd}
                  onChange={e => setEditUsd(e.target.value)}
                  placeholder="0"
                  className="w-24 bg-zinc-100 border border-brand-400 text-zinc-900 text-xs rounded px-2 py-1 focus:outline-none"
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(broker) }}
                />
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <div>
                <p className="text-[10px] text-zinc-500">ARS</p>
                <p className="text-sm font-semibold text-zinc-900">{manualCash[broker]?.ars !== null && manualCash[broker]?.ars !== undefined ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(manualCash[broker].ars!) : '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">USD</p>
                <p className="text-sm font-semibold text-zinc-900">{manualCash[broker]?.usd !== null && manualCash[broker]?.usd !== undefined ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(manualCash[broker].usd!) : '—'}</p>
              </div>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

type SortField = 'name' | 'type' | 'broker' | 'cost_basis' | 'current_value' | 'pnl' | 'pnl_pct'

export default function InvestmentsPage() {
  const queryClient = useQueryClient()
  const [brokerFilter, setBrokerFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [editing, setEditing] = useState<Investment | null | undefined>(undefined)
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'current_value', dir: 'desc' })
  const [showCreds, setShowCreds] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [showInUsd, setShowInUsd] = useState(false)
  const [usdRate, setUsdRate] = useState<{ rate: number; date: string } | null>(null)
  const [usdLoading, setUsdLoading] = useState(false)

  const { data: settings = {} } = useQuery({ queryKey: ['settings'], queryFn: getSettings, staleTime: 60_000 })
  const { data: cashBalances } = useQuery({ queryKey: ['cash-balances'], queryFn: getCashBalances, staleTime: 5 * 60_000 })
  const { data: manualCash = {}, refetch: refetchManualCash } = useQuery({ queryKey: ['manual-cash-balances'], queryFn: getManualCashBalances, staleTime: 0 })
  const manualCashMut = useMutation({
    mutationFn: ({ broker, ars, usd }: { broker: string; ars: number | null; usd: number | null }) =>
      putManualCashBalance(broker, ars, usd),
    onSuccess: () => refetchManualCash(),
  })
  const manualCashDelMut = useMutation({
    mutationFn: (broker: string) => deleteManualCashBalance(broker),
    onSuccess: () => refetchManualCash(),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['investments'] })

  const handleToggleUsd = async () => {
    if (showInUsd) { setShowInUsd(false); return }
    setUsdLoading(true)
    try {
      const r = await getUsdRate()
      setUsdRate(r)
      setShowInUsd(true)
      showSync(`USD Oficial: $${r.rate.toLocaleString('es-AR', { minimumFractionDigits: 2 })} · ${r.date}`, true)
    } catch {
      showSync('No se pudo obtener el tipo de cambio BCRA', false)
    } finally {
      setUsdLoading(false)
    }
  }

  const { data: investments = [], isLoading } = useQuery({
    queryKey: ['investments'],
    queryFn: () => getInvestments(),
  })

  const showSync = (text: string, ok: boolean) => {
    setSyncMsg({ text, ok })
    setTimeout(() => setSyncMsg(null), 10_000)
  }

  const syncAllMut = useMutation({
    mutationFn: async () => {
      const iolOk = settings.iol_configured === 'true' || (settings.iol_configured as any) === true
      const ppiOk = settings.ppi_configured === 'true' || (settings.ppi_configured as any) === true
      const results: string[] = []
      const errors: string[] = []
      if (iolOk) {
        try { const r = await syncIOL(); results.push(`IOL: ${r.updated}↑ ${r.created}+`) }
        catch (e: any) { errors.push(`IOL: ${e?.response?.data?.detail ?? 'error'}`) }
      }
      if (ppiOk) {
        try { const r = await syncPPI(); results.push(`PPI: ${r.updated}↑ ${r.created}+`) }
        catch (e: any) { errors.push(`PPI: ${e?.response?.data?.detail ?? 'error'}`) }
      }
      try { const r = await refreshManualPrices(); if (r.updated > 0) results.push(`Manuales: ${r.updated}↑`) }
      catch { /* non-critical */ }
      if (errors.length) throw new Error(errors.join(' · '))
      return results.join(' · ')
    },
    onSuccess: (msg) => { invalidate(); showSync(msg || 'Sincronizado', true) },
    onError: (e: Error) => { invalidate(); showSync(e.message, false) },
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

  const visible = investments
    .filter(i => !brokerFilter || i.broker === brokerFilter)
    .filter(i => !typeFilter || (i.type || 'Otro') === typeFilter)

  const sorted = [...visible].sort((a, b) => {
    const av = a[sort.field as keyof Investment] ?? 0
    const bv = b[sort.field as keyof Investment] ?? 0
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
    return sort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
  })

  const toggleSort = (field: SortField) =>
    setSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' })

  // ── USD conversion helper ────────────────────────────────────────────────────
  const toDisplay = (amount: number, currency: string) => {
    if (!showInUsd || !usdRate || currency === 'USD') return fmt(amount, currency)
    return fmt(amount / usdRate.rate, 'USD')
  }

  // ── Aggregates ──────────────────────────────────────────────────────────────
  const arsHoldings = visible.filter(i => i.currency === 'ARS')
  const usdHoldings = visible.filter(i => i.currency === 'USD')

  const arsValue  = arsHoldings.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0)
  const usdValue  = usdHoldings.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0)
  const arsCost   = arsHoldings.reduce((s, i) => s + i.cost_basis, 0)
  const usdCost   = usdHoldings.reduce((s, i) => s + i.cost_basis, 0)
  const arsPnl    = arsValue - arsCost
  const usdPnl    = usdValue - usdCost

  // Allocation by type — uses broker-filtered only, ignores typeFilter so the chart stays stable
  const visibleForChart = investments.filter(i => !brokerFilter || i.broker === brokerFilter)
  const byType: Record<string, number> = {}
  for (const inv of visibleForChart) {
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

          {/* Sync all brokers + manual prices */}
          <div className="flex flex-col items-end">
            <button
              onClick={() => syncAllMut.mutate()}
              disabled={syncAllMut.isPending || (!settings.iol_configured && !settings.ppi_configured)}
              title={(!settings.iol_configured && !settings.ppi_configured) ? 'Configurá las credenciales primero' : 'Sincronizar brokers y actualizar precios'}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-zinc-300 text-zinc-600 hover:text-zinc-900 hover:border-zinc-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {syncAllMut.isPending ? <span className="animate-spin inline-block">↻</span> : '↻'}
              Sincronizar
            </button>
          </div>

          {/* USD Conversion */}
          <button
            onClick={handleToggleUsd}
            disabled={usdLoading}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50 ${
              showInUsd
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-600 font-medium'
                : 'border-zinc-300 text-zinc-400 hover:text-zinc-700 hover:border-zinc-600'
            }`}
            title="Convertir valores ARS a USD oficial (BCRA)"
          >
            {usdLoading ? <span className="animate-spin inline-block text-xs">↻</span> : null}
            {showInUsd ? 'USD Oficial ✓' : '$ → USD'}
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
      <div className="flex items-center gap-2 flex-wrap">
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
        <button
          onClick={() => setEditing(null)}
          className="text-sm px-3 py-1.5 rounded-lg border border-dashed border-zinc-300 text-zinc-400 hover:text-zinc-700 hover:border-zinc-500 transition-all"
          title="Agregar posición con broker personalizado"
        >
          + broker
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-3">
          <p className="text-xs text-zinc-400 mb-0.5">Valor ARS</p>
          <p className="text-base font-bold text-zinc-900">{toDisplay(arsValue, 'ARS')}</p>
          <p className={`text-xs mt-0.5 font-medium ${arsPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {arsPnl >= 0 ? '+' : ''}{toDisplay(arsPnl, 'ARS')} P&L
          </p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-zinc-400 mb-0.5">Valor USD</p>
          <p className="text-base font-bold text-zinc-900">{fmt(usdValue, 'USD')}</p>
          <p className={`text-xs mt-0.5 font-medium ${usdPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {usdPnl >= 0 ? '+' : ''}{fmt(usdPnl, 'USD')} P&L
          </p>
        </div>

        {/* Saldos disponibles */}
        <div className="card p-3 col-span-2">
          <p className="text-xs text-zinc-400 font-medium uppercase tracking-wider mb-2">Saldos disponibles</p>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
            {/* IOL — auto from API */}
            {cashBalances?.iol.configured && (
              <div className="flex-shrink-0">
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">InvertirOnline</p>
                {cashBalances.iol.error
                  ? <p className="text-xs text-red-400">{cashBalances.iol.error}</p>
                  : <div className="flex gap-3">
                      <div><p className="text-[10px] text-zinc-500">ARS</p><p className="text-sm font-semibold text-zinc-900">{cashBalances.iol.ars !== null ? toDisplay(cashBalances.iol.ars, 'ARS') : '—'}</p></div>
                      <div><p className="text-[10px] text-zinc-500">USD</p><p className="text-sm font-semibold text-zinc-900">{cashBalances.iol.usd !== null ? fmt(cashBalances.iol.usd, 'USD') : '—'}</p></div>
                    </div>
                }
              </div>
            )}
            {/* PPI — auto from API */}
            {cashBalances?.ppi.configured && (
              <div className="flex-shrink-0">
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">Portfolio Personal</p>
                {cashBalances.ppi.error
                  ? <p className="text-xs text-red-400">{cashBalances.ppi.error}</p>
                  : <div className="flex gap-3">
                      <div><p className="text-[10px] text-zinc-500">ARS</p><p className="text-sm font-semibold text-zinc-900">{cashBalances.ppi.ars !== null ? toDisplay(cashBalances.ppi.ars, 'ARS') : '—'}</p></div>
                      <div><p className="text-[10px] text-zinc-500">USD</p><p className="text-sm font-semibold text-zinc-900">{cashBalances.ppi.usd !== null ? fmt(cashBalances.ppi.usd, 'USD') : '—'}</p></div>
                    </div>
                }
              </div>
            )}
            {/* Manual brokers — editable, horizontal */}
            <ManualCashSection
              knownBrokers={brokers.filter(b => b !== 'InvertirOnline' && b !== 'Portfolio Personal')}
              manualCash={manualCash}
              onSave={(broker, ars, usd) => manualCashMut.mutate({ broker, ars, usd })}
              onDelete={(broker) => manualCashDelMut.mutate(broker)}
            />
            {!cashBalances?.iol.configured && !cashBalances?.ppi.configured && Object.keys(manualCash).length === 0 && (
              <p className="text-xs text-zinc-400">Configurá las credenciales de IOL o PPI, o agregá un broker manual</p>
            )}
          </div>
        </div>
      </div>

      {/* Composición — bar chart */}
      {totalValue > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Composición por tipo</p>
            {typeFilter && (
              <button onClick={() => setTypeFilter(null)} className="text-xs text-indigo-500 hover:text-indigo-700">
                × {typeFilter}
              </button>
            )}
          </div>
          <div className="space-y-2.5">
            {Object.entries(byType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, val]) => {
                const pctVal = (val / totalValue) * 100
                const color = TYPE_COLORS[type] || '#94a3b8'
                const active = typeFilter === type
                return (
                  <div
                    key={type}
                    className={`flex items-center gap-3 rounded cursor-pointer px-1 py-0.5 transition-colors ${active ? 'bg-zinc-100' : 'hover:bg-zinc-50'}`}
                    onClick={() => setTypeFilter(active ? null : type)}
                  >
                    <span className="text-xs text-zinc-500 w-20 flex-shrink-0 text-right">{type}</span>
                    <div className="flex-1 h-5 bg-zinc-100 rounded overflow-hidden">
                      <div
                        className="h-full rounded transition-all duration-500"
                        style={{ width: `${pctVal}%`, backgroundColor: color, opacity: active ? 1 : 0.8 }}
                      />
                    </div>
                    <span className="text-xs font-semibold w-10 flex-shrink-0" style={{ color }}>
                      {pctVal.toFixed(1)}%
                    </span>
                    <span className="text-xs text-zinc-400 w-32 flex-shrink-0 text-right hidden sm:block">
                      {toDisplay(val, 'ARS')}
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

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
                    <td className="px-4 py-3 text-right text-zinc-600">{toDisplay(inv.cost_basis, inv.currency)}</td>
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
                      {inv.current_value !== null ? toDisplay(inv.current_value, inv.currency) : <span className="text-zinc-500 font-normal">—</span>}
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
          defaultBroker={editing === null ? brokerFilter : undefined}
          knownBrokers={brokers}
        />
      )}

      {showCreds && (
        <CredentialsModal
          settings={settings}
          onClose={() => setShowCreds(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['settings'] })}
        />
      )}
    </div>
  )
}
