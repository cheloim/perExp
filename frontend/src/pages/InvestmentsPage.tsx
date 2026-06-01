import { useState, useRef, useEffect, useMemo } from 'react'
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
  lookupSymbol,
  lookupSymbols,
} from '../api/client'
import type { Investment, InvestmentCreate } from '../types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { InvestmentDetailModal } from '../components/InvestmentDetailModal'

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

function PnlChip({ pnl, pnl_pct, currency, showInUsd, usdRate }: { pnl: number | null; pnl_pct: number | null; currency: string; showInUsd?: boolean; usdRate?: { rate: number; date: string } }) {
  if (pnl === null) return <span className="text-tertiary text-xs">—</span>
  const pos = pnl >= 0
  const displayPnl = (showInUsd && usdRate && currency === 'ARS') ? pnl / usdRate.rate : pnl
  const displayCurrency = (showInUsd && usdRate && currency === 'ARS') ? 'USD' : currency
  return (
    <div className={`flex flex-col items-end gap-0.5`}>
      <span className={`text-sm font-semibold ${pos ? 'text-success' : 'text-danger'}`}>
        {pos ? '+' : ''}{fmt(displayPnl, displayCurrency)}
      </span>
      {pnl_pct !== null && (
        <span className={`text-xs ${pos ? 'text-success' : 'text-danger'}`}>
          {fmtPct(pnl_pct)}
        </span>
      )}
    </div>
  )
}

// @ts-ignore
function _InlinePriceEdit({ inv, onSave }: { inv: Investment; onSave: (price: number | null) => void }) {
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
        className="w-28 bg-base-alt border border-primary text-[var(--text-primary)] text-sm rounded px-2 py-1 focus:outline-none"
      />
    )
  }

  return (
    <button
      onClick={() => { setVal(inv.current_price !== null ? String(inv.current_price) : ''); setEditing(true) }}
      className="group flex items-center gap-1 text-sm text-secondary hover:text-[var(--text-primary)] transition-colors"
      title="Clic para editar precio"
    >
      {inv.current_price !== null ? fmt(inv.current_price, inv.currency) : <span className="text-tertiary">— sin precio</span>}
      <span className="text-secondary group-hover:text-tertiary text-xs">✏</span>
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

  const [symbolSearchError, setSymbolSearchError] = useState(false)
  const [isLookingUpSymbol, setIsLookingUpSymbol] = useState(false)

  useEffect(() => {
    const symbol = form.ticker?.trim() || ''
    if (symbol.length < 1) {
      setSymbolSearchError(false)
      return
    }

    const timer = setTimeout(async () => {
      setIsLookingUpSymbol(true)
      setSymbolSearchError(false)
      try {
        const result = await lookupSymbol(symbol)
        if (result) {
          if (!form.name) set('name', result.name)
          if (result.price) set('current_price', result.price)
        } else {
          setSymbolSearchError(true)
        }
      } catch {
        setSymbolSearchError(true)
      } finally {
        setIsLookingUpSymbol(false)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [form.ticker])

  const set = (k: keyof InvestmentCreate, v: unknown) =>
    setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative card w-full max-w-lg max-h-[90vh] overflow-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-[var(--text-primary)])]">{initial ? 'Editar inversión' : 'Nueva inversión'}</h2>
          <button onClick={onClose} className="text-tertiary hover:text-[var(--text-primary)]">✕</button>
        </div>

        {/* Broker + Type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">Broker</label>
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
            <label className="block text-sm font-medium text-secondary mb-1">Tipo</label>
            <select value={form.type} onChange={e => set('type', e.target.value)} className="w-full input">
              {INVESTMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Symbol + Name */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">Symbol</label>
            <div className="relative">
              <input
                type="text"
                value={form.ticker}
                onChange={e => set('ticker', e.target.value.toUpperCase())}
                placeholder="GGAL"
                className="w-full input uppercase pr-8"
              />
              {isLookingUpSymbol && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  <span className="spinner" />
                </span>
              )}
            </div>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-secondary mb-1">Nombre</label>
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
            <label className="block text-sm font-medium text-secondary mb-1">Cantidad</label>
            <input
              type="number"
              value={form.quantity}
              onChange={e => set('quantity', parseFloat(e.target.value) || 0)}
              onFocus={e => e.target.select()}
              className="w-full input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">Moneda</label>
            <select value={form.currency} onChange={e => set('currency', e.target.value)} className="w-full input">
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        {/* Avg cost + Current price */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">Precio promedio</label>
            <CurrencyInput
              value={form.avg_cost ?? null}
              onChange={v => set('avg_cost', v ?? 0)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">Precio actual</label>
            <CurrencyInput
              value={form.current_price ?? null}
              onChange={v => set('current_price', v)}
              placeholder="Opcional"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary mb-1">Notas</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="w-full input" rows={2} />
        </div>

        {symbolSearchError && (
          <p className="text-xs text-warning">
            ⚠️ No se encontró el symbol. No se podrá actualizar el precio automáticamente.
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="gnome-btn-secondary flex-1">Cancelar</button>
          <button onClick={() => onSave(form)} className="gnome-btn-primary flex-1">Guardar</button>
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
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Configuración de brokers</h2>
          <button onClick={onClose} className="text-tertiary hover:text-[var(--text-primary)]">✕</button>
        </div>

        {saved && (
          <div className="bg-success/10 border border-success/30 rounded-lg px-3 py-2 text-xs text-success font-medium">
            ✓ Credenciales guardadas correctamente
          </div>
        )}
        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger font-medium">
            ✗ {error}
          </div>
        )}

        {/* IOL */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-tertiary uppercase tracking-wider">InvertirOnline</p>
            <span className={`text-xs font-medium ${iolOk ? 'text-success' : 'text-tertiary'}`}>
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
            <p className="text-xs font-semibold text-tertiary uppercase tracking-wider">Portfolio Personal</p>
            <span className={`text-xs font-medium ${ppiOk ? 'text-success' : 'text-tertiary'}`}>
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
          <button onClick={onClose} className="gnome-btn-secondary flex-1">Cerrar</button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="gnome-btn-primary flex-1 disabled:opacity-40"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// @ts-ignore
function _ManualCashSection({
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
            <p className="text-[10px] font-semibold text-tertiary uppercase tracking-wide">{broker}</p>
            {editing === broker
              ? <button onClick={() => commitEdit(broker)} className="text-[10px] text-success hover:text-success/70">✓</button>
              : <button onClick={() => startEdit(broker)} className="text-[10px] text-tertiary hover:text-[var(--text-primary)]">✏</button>
            }
            <button onClick={() => onDelete(broker)} className="text-[10px] text-danger hover:text-danger/70">✕</button>
          </div>
          {editing === broker ? (
            <div className="flex gap-2">
              <div>
                <p className="text-[10px] text-tertiary">ARS</p>
                <input
                  type="number"
                  value={editArs}
                  onChange={e => setEditArs(e.target.value)}
                  placeholder="0"
                  autoFocus
                  className="w-28 bg-base-alt border border-primary text-[var(--text-primary)] text-xs rounded px-2 py-1 focus:outline-none"
                />
              </div>
              <div>
                <p className="text-[10px] text-tertiary">USD</p>
                <input
                  type="number"
                  value={editUsd}
                  onChange={e => setEditUsd(e.target.value)}
                  placeholder="0"
                  className="w-24 bg-base-alt border border-primary text-[var(--text-primary)] text-xs rounded px-2 py-1 focus:outline-none"
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(broker) }}
                />
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <div>
                <p className="text-[10px] text-tertiary">ARS</p>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{manualCash[broker]?.ars !== null && manualCash[broker]?.ars !== undefined ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(manualCash[broker].ars!) : '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-tertiary">USD</p>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{manualCash[broker]?.usd !== null && manualCash[broker]?.usd !== undefined ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(manualCash[broker].usd!) : '—'}</p>
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
  const [viewing, setViewing] = useState<Investment | null>(null)
  const [viewingAggregated, setViewingAggregated] = useState<(Investment & { brokers: string[]; investments: Investment[] }) | null>(null)
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'current_value', dir: 'desc' })
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [showCreds, setShowCreds] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [showInUsd, setShowInUsd] = useState(false)
  const [usdRate, setUsdRate] = useState<{ rate: number; date: string } | null>(null)
  const [usdLoading, setUsdLoading] = useState(false)
  const [lastUsdRateFetch, setLastUsdRateFetch] = useState<number | null>(null)
  const [brokerDropdownOpen, setBrokerDropdownOpen] = useState<string | null>(null)
  const [yahooPrices, setYahooPrices] = useState<Record<string, { price: number; currency: string }>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollIntervalRef = useRef<number | null>(null)

  // @ts-ignore
  const _startScroll = (direction: 'left' | 'right') => {
    scrollIntervalRef.current = window.setInterval(() => {
      scrollRef.current?.scrollBy({ left: direction === 'left' ? -4 : 4, behavior: 'auto' })
    }, 20)
  }

  // @ts-ignore
  const _stopScroll = () => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current)
      scrollIntervalRef.current = null
    }
  }

  useEffect(() => {
    return () => { if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current) }
  }, [])

  // ── Filter by broker (defined early for use in useEffect) ───────────────────────
  // brokerFiltered se calcula dentro del useEffect para evitar ReferenceError

  // Close broker dropdown when clicking outside
  useEffect(() => {
    if (!brokerDropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-broker-dropdown]')) {
        setBrokerDropdownOpen(null)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [brokerDropdownOpen])

  const { data: settings = {} } = useQuery({ queryKey: ['settings'], queryFn: getSettings, staleTime: 60_000 })
  const { data: cashBalances } = useQuery({ queryKey: ['cash-balances'], queryFn: getCashBalances, staleTime: 15 * 60_000 })
  // @ts-ignore
  const { data: manualCash = {}, refetch: refetchManualCash } = useQuery({ queryKey: ['manual-cash-balances'], queryFn: getManualCashBalances, staleTime: 0 })
  // @ts-ignore
  const _manualCashMut = useMutation({
    mutationFn: ({ broker, ars, usd }: { broker: string; ars: number | null; usd: number | null }) =>
      putManualCashBalance(broker, ars, usd),
    onSuccess: () => refetchManualCash(),
  })
  // @ts-ignore
  const _manualCashDelMut = useMutation({
    mutationFn: (broker: string) => deleteManualCashBalance(broker),
    onSuccess: () => refetchManualCash(),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['investments'] })

  const isBusinessHoursARG = () => {
    const now = new Date()
    const argTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const hours = argTime.getHours()
    return hours >= 8 && hours < 19
  }

  const fetchUsdRateIfNeeded = async () => {
    if (!usdRate || Date.now() - (lastUsdRateFetch || 0) > 30 * 60 * 1000) {
      if (isBusinessHoursARG()) {
        try {
          const r = await getUsdRate()
          setUsdRate(r)
          setLastUsdRateFetch(Date.now())
        } catch { /* silent fail for auto-fetch */ }
      }
    }
  }

  const handleToggleUsd = async () => {
    if (showInUsd) { setShowInUsd(false); return }
    setUsdLoading(true)
    try {
      const r = await getUsdRate()
      setUsdRate(r)
      setLastUsdRateFetch(Date.now())
      setShowInUsd(true)
      showSync(`USD: $${r.rate.toLocaleString('es-AR', { minimumFractionDigits: 2 })} · ${r.date}`, true)
    } catch {
      showSync('No se pudo obtener el tipo de cambio USD', false)
    } finally {
      setUsdLoading(false)
    }
  }

  useEffect(() => {
    if (isBusinessHoursARG()) {
      fetchUsdRateIfNeeded()
    }
    const timer = setInterval(fetchUsdRateIfNeeded, 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  const { data: investments = [], isLoading } = useQuery({
    queryKey: ['investments'],
    queryFn: () => getInvestments(),
  })

  // ── Filter by broker (useMemo to avoid initialization order issues) ────────────
  const brokerFiltered = useMemo(() =>
    investments.filter(i => !brokerFilter || i.broker === brokerFilter),
    [investments, brokerFilter]
  )

  // Fetch Yahoo prices for tickers with multiple brokers
  useEffect(() => {
    if (!investments || investments.length === 0) return
    const tickers = [...new Set(brokerFiltered.map(i => i.ticker).filter(Boolean))] as string[]
    if (tickers.length === 0) return

    lookupSymbols(tickers).then(prices => {
      if (prices) {
        const simplified = Object.fromEntries(
          Object.entries(prices)
            .filter(([, v]) => v.price !== null)
            .map(([k, v]) => [k, { price: v.price as number, currency: v.currency }])
        )
        setYahooPrices(prev => ({ ...prev, ...simplified }))
      }
    })
  }, [brokerFiltered])

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
  // @ts-ignore
  const _priceMut  = useMutation({
    mutationFn: ({ id, price }: { id: number; price: number | null }) => updateInvestmentPrice(id, price),
    onSuccess: invalidate,
  })
  const deleteMut = useMutation({ mutationFn: deleteInvestment, onSuccess: invalidate })

  const handleSave = (data: InvestmentCreate) => {
    if (editing && editing.id) updateMut.mutate({ id: editing.id, data })
    else createMut.mutate(data)
  }

  // ── Aggregate by ticker ───────────────────────────────────────────────────────
  type AggregatedInv = Investment & { brokers: string[]; investments: Investment[] }
  const tickerMap = new Map<string, AggregatedInv>()

  for (const inv of brokerFiltered) {
    const key = inv.ticker || inv.name || `__${inv.id}__`
    const existing = tickerMap.get(key)
    if (existing) {
      // Agregar al ticker existente
      const newQty = existing.quantity + inv.quantity
      if (newQty > 0) {
        existing.avg_cost = ((existing.avg_cost ?? 0) * existing.quantity + (inv.avg_cost ?? 0) * inv.quantity) / newQty
      }
      existing.quantity = newQty
      existing.cost_basis = (existing.cost_basis ?? 0) + (inv.cost_basis ?? 0)
      const currVal = inv.current_value ?? inv.cost_basis ?? 0
      const existVal = existing.current_value ?? existing.cost_basis ?? 0
      existing.current_value = existVal + currVal
      existing.pnl = (existing.current_value ?? 0) - (existing.cost_basis ?? 0)
      existing.pnl_pct = existing.cost_basis ? ((existing.pnl ?? 0) / existing.cost_basis) * 100 : 0
      // Usar current_price más reciente
      if (inv.current_price && (!existing.current_price || (inv.updated_at && existing.updated_at && inv.updated_at > existing.updated_at))) {
        existing.current_price = inv.current_price
      }
      if (!existing.brokers.includes(inv.broker)) {
        existing.brokers.push(inv.broker)
      }
      existing.investments.push(inv)
    } else {
      tickerMap.set(key, {
        ...inv,
        brokers: [inv.broker],
        investments: [inv],
      })
    }
  }

  const visible = Array.from(tickerMap.values())
    .filter(i => !typeFilter || (i.type || 'Otro') === typeFilter)
    .map(inv => {
      // Si tenemos precio de Yahoo para este ticker, usarlo
      if (inv.ticker && yahooPrices[inv.ticker]?.price) {
        const yf = yahooPrices[inv.ticker]
        const newCurrentValue = inv.quantity * yf.price
        const newPnl = newCurrentValue - inv.cost_basis
        const newPnlPct = inv.cost_basis ? (newPnl / inv.cost_basis) * 100 : 0
        return {
          ...inv,
          current_price: yf.price,
          current_value: newCurrentValue,
          pnl: newPnl,
          pnl_pct: newPnlPct,
        }
      }
      return inv
    })

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

  // @ts-ignore
  const _arsValue  = arsHoldings.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0)
  // @ts-ignore
  const _usdValue  = usdHoldings.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0)
  // @ts-ignore
  const _arsCost   = arsHoldings.reduce((s, i) => s + i.cost_basis, 0)
  // @ts-ignore
  const _usdCost   = usdHoldings.reduce((s, i) => s + i.cost_basis, 0)
  // @ts-ignore
  const _arsPnl    = _arsValue - _arsCost
  // @ts-ignore
  const _usdPnl    = _usdValue - _usdCost

  // ── Full portfolio aggregates (unfiltered) for TOTAL ─────────────────────────
  const allArsHoldings = investments.filter(i => i.currency === 'ARS')
  const allUsdHoldings = investments.filter(i => i.currency === 'USD')
  const totalArsValue  = allArsHoldings.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0)
  const totalUsdValue  = allUsdHoldings.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0)
  const totalArsCost   = allArsHoldings.reduce((s, i) => s + i.cost_basis, 0)
  const totalUsdCost   = allUsdHoldings.reduce((s, i) => s + i.cost_basis, 0)
  const totalArsPnl    = totalArsValue - totalArsCost
  const totalUsdPnl    = totalUsdValue - totalUsdCost

  // Allocation by type — uses broker-filtered only, ignores typeFilter so the chart stays stable
  const visibleForChart = investments.filter(i => !brokerFilter || i.broker === brokerFilter)
  const byType: Record<string, number> = {}
  for (const inv of visibleForChart) {
    const v = inv.current_value ?? inv.cost_basis
    byType[inv.type || 'Otro'] = (byType[inv.type || 'Otro'] ?? 0) + v
  }
  const totalValue = Object.values(byType).reduce((s, v) => s + v, 0)


  const brokers = [...new Set(investments.map(i => i.broker).filter(Boolean))]

  // ── Per-broker aggregates ────────────────────────────────────────────────────
  const allBrokers = ['InvertirOnline', 'Portfolio Personal', ...brokers.filter(b => b !== 'InvertirOnline' && b !== 'Portfolio Personal')]
  const brokerData = allBrokers.map(broker => {
    const bInv = investments.filter(i => i.broker === broker)
    const bArs = bInv.filter(i => i.currency === 'ARS')
    const bUsd = bInv.filter(i => i.currency === 'USD')
    const bArsValue = bArs.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0)
    const bUsdValue = bUsd.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0)
    const bArsCost  = bArs.reduce((s, i) => s + i.cost_basis, 0)
    const bUsdCost  = bUsd.reduce((s, i) => s + i.cost_basis, 0)
    const bArsPnl   = bArsValue - bArsCost
    const bUsdPnl   = bUsdValue - bUsdCost
    return { broker, arsValue: bArsValue, usdValue: bUsdValue, arsPnl: bArsPnl, usdPnl: bUsdPnl, count: bInv.length }
  }).filter(b => b.count > 0 || b.broker === 'InvertirOnline' || b.broker === 'Portfolio Personal')

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sort.field !== field) return <span className="ml-1 text-tertiary">↕</span>
    return <span className="ml-1 text-[var(--text-primary)]">{sort.dir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Fixed header section */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Inversiones</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Sync status toast */}
          {syncMsg && (
            <span className={`text-xs px-3 py-1.5 rounded-lg font-medium ${syncMsg.ok ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'}`}>
              {syncMsg.text}
            </span>
          )}

          {/* Sync all brokers + manual prices */}
          <button
            onClick={() => syncAllMut.mutate()}
            disabled={syncAllMut.isPending || (!settings.iol_configured && !settings.ppi_configured)}
            title={(!settings.iol_configured && !settings.ppi_configured) ? 'Configurá las credenciales primero' : 'Sincronizar brokers y actualizar precios'}
            className={`gnome-btn-secondary-round text-sm ${syncAllMut.isPending ? 'opacity-60' : ''}`}
          >
            {syncAllMut.isPending ? <span className="animate-spin inline-block">↻</span> : '↻'}
            <span>Sincronizar</span>
          </button>

          {/* USD Conversion */}
          <button
            onClick={handleToggleUsd}
            disabled={usdLoading}
            className={`gnome-btn-secondary-round text-sm ${showInUsd ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)] border-transparent' : ''}`}
            title="Convertir valores ARS a USD"
          >
            {usdLoading ? <span className="animate-spin inline-block">↻</span> : null}
            <span>{showInUsd ? 'USD' : 'ARS'}</span>
          </button>

          <button
            onClick={() => setShowCreds(true)}
            className="gnome-btn-secondary-round text-sm"
            title="Configurar credenciales"
          >
            <span className="text-base leading-none">⚙</span>
            <span>Config</span>
          </button>

          <button onClick={() => setEditing(null)} className="gnome-btn-primary-round text-sm">
            <span className="text-base leading-none">+</span>
            <span>Nueva</span>
          </button>
        </div>
      </div>

      {/* Resumen de cartera - GNOME 50 style */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wider">Resumen de cartera</p>
          {usdRate && (
            <p className="text-xs text-[var(--text-tertiary)]">USD: {usdRate.rate.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
          )}
        </div>

        {/* Broker pills + TOTAL */}
        <div className="flex items-center justify-between gap-2 mb-3">
          {/* Broker pills */}
          <div className="flex flex-wrap items-center gap-1">
            {brokerData.map((b) => {
              const isSelected = brokerFilter === b.broker
              const isOpen = brokerDropdownOpen === b.broker
              const arsCost = b.arsValue - b.arsPnl
// @ts-ignore
              const arsPnlPct = arsCost > 0 ? (b.arsPnl / arsCost) * 100 : 0
              return (
                <div key={b.broker} className="relative" data-broker-dropdown>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (isSelected) {
                        setBrokerFilter(null)
                      } else {
                        setBrokerFilter(b.broker)
                      }
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { if (isSelected) { setBrokerFilter(null) } else { setBrokerFilter(b.broker) } } }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      isSelected
                        ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]'
                        : 'bg-[var(--color-base-alt)] text-[var(--text-secondary)] hover:bg-[var(--color-base)]'
                    }`}
                  >
                    <span>{isSelected ? '●' : '○'}</span>
                    <span>{b.broker}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setBrokerDropdownOpen(isOpen ? null : b.broker)
                      }}
                      onPointerDown={(e) => {
                        if (e.pointerType === 'touch') {
                          e.preventDefault()
                          const timer = setTimeout(() => {
                            if (!isOpen) {
                              setBrokerDropdownOpen(b.broker)
                            }
                          }, 500)
                          ;(e.currentTarget as HTMLElement).dataset.pressTimer = String(timer)
                        }
                      }}
                      onPointerUp={(e) => {
                        if (e.pointerType === 'touch') {
                          const timer = (e.currentTarget as HTMLElement).dataset.pressTimer
                          if (timer) {
                            clearTimeout(parseInt(timer))
                            delete (e.currentTarget as HTMLElement).dataset.pressTimer
                          }
                        }
                      }}
                      className="ml-0.5 text-xs hover:opacity-70"
                    >
                      ▼
                    </button>
                  </div>
                  {/* Dropdown */}
                  {isOpen && isSelected && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-lg py-1 z-20">
                      <button
                        onClick={() => { setBrokerDropdownOpen(null); setEditing(null) }}
                        className="w-full px-3 py-2 text-sm text-left text-[var(--text-primary)] hover:bg-[var(--color-base-alt)] flex items-center gap-2"
                      >
                        <span className="text-[var(--text-tertiary)]">+</span> Agregar inversión
                      </button>
                      {(b.broker === 'InvertirOnline' || b.broker === 'Portfolio Personal') && (
                        <button
                          onClick={() => { setBrokerDropdownOpen(null); setShowCreds(true) }}
                          className="w-full px-3 py-2 text-sm text-left text-[var(--text-primary)] hover:bg-[var(--color-base-alt)] flex items-center gap-2"
                        >
                          <span className="text-[var(--text-tertiary)]">⚙</span> Configurar
                        </button>
                      )}
                      <button
                        onClick={() => { setBrokerDropdownOpen(null); syncAllMut.mutate() }}
                        className="w-full px-3 py-2 text-sm text-left text-[var(--text-primary)] hover:bg-[var(--color-base-alt)] flex items-center gap-2"
                      >
                        <span className="text-[var(--text-tertiary)]">↻</span> Sincronizar
                      </button>
                      <div className="border-t border-[var(--border-color)] my-1" />
                      <div className="px-3 py-2 text-xs text-[var(--text-tertiary)]">
                        <p className="font-medium text-[var(--text-secondary)] mb-1">Saldo disponible</p>
                        {cashBalances?.iol.configured && b.broker === 'InvertirOnline' && (
                          <p>ARS: {cashBalances.iol.ars !== null ? fmt(cashBalances.iol.ars) : '—'} | USD: {cashBalances.iol.usd !== null ? fmt(cashBalances.iol.usd) : '—'}</p>
                        )}
                        {cashBalances?.ppi.configured && b.broker === 'Portfolio Personal' && (
                          <p>ARS: {cashBalances.ppi.ars !== null ? fmt(cashBalances.ppi.ars) : '—'} | USD: {cashBalances.ppi.usd !== null ? fmt(cashBalances.ppi.usd) : '—'}</p>
                        )}
                        {b.broker !== 'InvertirOnline' && b.broker !== 'Portfolio Personal' && (
                          <p className="text-[var(--text-tertiary)]">No disponible</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* TOTAL - right side, info only, clickeable to clear filter */}
          <div className="flex-shrink-0">
            <button
              onClick={() => { setBrokerFilter(null); setBrokerDropdownOpen(null) }}
              className={`flex flex-col items-end px-3 py-1.5 rounded-lg transition-all ${brokerFilter === null ? 'bg-transparent' : 'hover:bg-[var(--color-base-alt)]'}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--text-tertiary)] uppercase">Total</span>
                {brokerFilter !== null && (
                  <span className="text-[10px] text-[var(--color-primary)]">●</span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-[var(--text-primary)]">{toDisplay(totalArsValue, 'ARS')}</span>
                <span className="text-xs text-[var(--text-tertiary)]">ARS</span>
              </div>
              <div className={`text-xs font-medium ${(totalArsPnl + totalUsdPnl) >= 0 ? 'text-success' : 'text-danger'}`}>
                {(totalArsPnl + totalUsdPnl) >= 0 ? '+' : ''}{toDisplay(totalArsPnl, 'ARS')} + {fmt(totalUsdPnl, 'USD')} P&L
              </div>
            </button>
          </div>
        </div>

        {/* Info del broker seleccionado debajo */}
        {brokerFilter && (() => {
          const b = brokerData.find(x => x.broker === brokerFilter)
          if (!b) return null
          const arsCost = b.arsValue - b.arsPnl
          const arsPnlPct = arsCost > 0 ? (b.arsPnl / arsCost) * 100 : 0
          return (
            <div className="flex items-center gap-4 px-2 py-2 bg-[var(--color-base-alt)] rounded-lg">
              <div>
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Valor ARS</p>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{toDisplay(b.arsValue, 'ARS')}</p>
              </div>
              {b.usdValue > 0 && (
                <div>
                  <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Valor USD</p>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{fmt(b.usdValue, 'USD')}</p>
                </div>
              )}
              <div>
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase">P&L</p>
                <p className={`text-sm font-semibold ${b.arsPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                  {b.arsPnl >= 0 ? '+' : ''}{toDisplay(b.arsPnl, 'ARS')} ({arsPnlPct >= 0 ? '+' : ''}{arsPnlPct.toFixed(1)}%)
                </p>
              </div>
            </div>
          )
        })()}
      </div>

      {/* Composición — bar chart */}
      {totalValue > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-tertiary font-medium uppercase tracking-wider">Composición por tipo</p>
            {typeFilter && (
              <button onClick={() => setTypeFilter(null)} className="text-xs text-secondary hover:text-[var(--text-primary)]">
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
                    className={`flex items-center gap-3 rounded cursor-pointer px-1 py-0.5 transition-colors ${active ? 'bg-base-alt' : 'hover:bg-base-alt'}`}
                    onClick={() => setTypeFilter(active ? null : type)}
                  >
                    <span className="text-xs text-tertiary w-20 flex-shrink-0 text-right">{type}</span>
                    <div className="flex-1 h-5 bg-base-alt rounded overflow-hidden">
                      <div
                        className="h-full rounded transition-all duration-500"
                        style={{ width: `${pctVal}%`, backgroundColor: color, opacity: active ? 1 : 0.8 }}
                      />
                    </div>
                    <span className="text-xs font-semibold w-10 flex-shrink-0" style={{ color }}>
                      {pctVal.toFixed(1)}%
                    </span>
                    <span className="text-xs text-tertiary w-32 flex-shrink-0 text-right hidden sm:block">
                      {toDisplay(val, 'ARS')}
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      )}
      </div>

      {/* Scrollable table area */}
      <div className="flex-1 min-h-[150px] max-h-[55vh] overflow-hidden px-6 pb-6">

      {/* Holdings table */}
      <div className="card h-full overflow-hidden flex flex-col">
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-surface border-b border-border-color sticky top-0 z-10 flex-none">
              <tr>
                <th className="px-3 py-3 text-left text-secondary font-medium cursor-pointer hover:text-[var(--text-primary)] whitespace-nowrap" onClick={() => toggleSort('name')}>
                  Activo <SortIcon field="name" />
                </th>
                <th className="px-2 py-3 text-left text-secondary font-medium cursor-pointer hover:text-[var(--text-primary)]" onClick={() => toggleSort('type')}>
                  Tipo <SortIcon field="type" />
                </th>
                <th className="px-2 py-3 text-left text-secondary font-medium cursor-pointer hover:text-[var(--text-primary)]" onClick={() => toggleSort('broker')}>
                  Broker <SortIcon field="broker" />
                </th>
                <th className="px-2 py-3 text-right text-secondary font-medium whitespace-nowrap">
                  Precio actual
                </th>
                <th className="px-2 py-3 text-right text-secondary font-medium cursor-pointer hover:text-[var(--text-primary)] whitespace-nowrap" onClick={() => toggleSort('current_value')}>
                  Valor actual <SortIcon field="current_value" />
                </th>
                <th className="px-2 py-3 text-right text-secondary font-medium cursor-pointer hover:text-[var(--text-primary)]" onClick={() => toggleSort('pnl')}>
                  P&L <SortIcon field="pnl" />
                </th>
                <th className="px-1 py-3 text-center text-secondary font-medium w-16">Acc.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-color">
              {isLoading ? (
                <tr><td colSpan={7} className="py-10 text-center text-tertiary">Cargando...</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-tertiary">Sin inversiones registradas</td></tr>
              ) : (
                sorted.map((inv, idx) => (
                  <tr key={inv.ticker || inv.name || idx} className="hover:bg-base-alt/30 transition-colors">
                    <td className="px-3 py-3 cursor-pointer" onClick={() => { setViewing(inv.investments[0]); setViewingAggregated(inv) }}>
                      <div>
                        {inv.ticker && (
                          <span className="text-xs font-bold font-mono text-[var(--text-primary)] mr-2">{inv.ticker}</span>
                        )}
                        <span className="text-[var(--text-primary)] font-medium">{inv.name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor: '#9a9996' + '20',
                          color: TYPE_COLORS[inv.type] || '#94a3b8',
                        }}
                      >
                        {inv.type || '—'}
                      </span>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap gap-1">
                        {inv.brokers.map(b => (
                          <span key={b} className="inline-block px-1.5 py-0.5 rounded text-xs bg-base-alt text-tertiary">
                            {b}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right text-secondary text-sm">
                      {inv.current_price !== null ? toDisplay(inv.current_price, inv.currency) : '—'}
                    </td>
                    <td className="px-2 py-3 text-right font-semibold text-[var(--text-primary)]">
                      {inv.current_value !== null ? toDisplay(inv.current_value, inv.currency) : <span className="text-tertiary font-normal">—</span>}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <PnlChip pnl={inv.pnl} pnl_pct={inv.pnl_pct} currency={inv.currency} showInUsd={showInUsd} usdRate={usdRate ?? undefined} />
                    </td>
                    <td className="px-1 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setEditing(inv.investments[0])} className="text-[var(--text-primary)] hover:brightness-110 p-1">✏️</button>
                        <button
                          onClick={() => setDeleteConfirmId(inv.investments[0].id)}
                          className="text-danger hover:brightness-110 p-1"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {sorted.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2 border-t border-border-color text-xs text-tertiary text-right">
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

      <InvestmentDetailModal
        isOpen={viewing !== null}
        investment={viewing}
        allInvestments={viewingAggregated?.investments}
        onClose={() => { setViewing(null); setViewingAggregated(null) }}
        onEdit={(inv) => { setViewing(null); setViewingAggregated(null); setEditing(inv) }}
      />

      {showCreds && (
        <CredentialsModal
          settings={settings}
          onClose={() => setShowCreds(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['settings'] })}
        />
      )}

      {deleteConfirmId !== null && (
        <ConfirmDialog
          isOpen={true}
          title="Eliminar inversión"
          message="¿Estás seguro de eliminar esta inversión? Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={() => {
            deleteMut.mutate(deleteConfirmId)
            setDeleteConfirmId(null)
          }}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  )
}
