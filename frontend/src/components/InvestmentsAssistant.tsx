import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getInvestments } from '../api/client'
import type { Investment } from '../types'

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

interface Session {
  id: string
  ts: number             // session start timestamp
  messages: ChatMessage[]
  summary?: string       // LLM-generated summary
}

// ── Storage ──────────────────────────────────────────────────────────────────

const SESSIONS_KEY = 'inv_assistant_sessions'
const ACTIVE_KEY   = 'inv_assistant_active'   // id of current session

function loadSessions(): Session[] {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]') } catch { return [] }
}
function saveSessions(s: Session[]) {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(s.slice(-30))) } catch { /* ignore */ }
}
function loadActiveId(): string {
  return localStorage.getItem(ACTIVE_KEY) || ''
}
function saveActiveId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id)
}
function newSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// ── Portfolio context ─────────────────────────────────────────────────────────

function buildPortfolioContext(investments: Investment[]): string {
  if (!investments.length) return ''
  const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const ars = investments.filter(i => i.currency === 'ARS')
  const usd = investments.filter(i => i.currency === 'USD')
  const arsV = ars.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0)
  const usdV = usd.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0)
  const arsC = ars.reduce((s, i) => s + i.cost_basis, 0)
  const usdC = usd.reduce((s, i) => s + i.cost_basis, 0)
  const lines = [
    '=== CARTERA ACTUAL ===',
    `ARS: $${fmt(arsV)} (costo $${fmt(arsC)}, P&L $${fmt(arsV - arsC)})`,
    `USD: u$s${fmt(usdV)} (costo u$s${fmt(usdC)}, P&L u$s${fmt(usdV - usdC)})`,
    'POSICIONES:',
    ...investments.map(inv => {
      const v = inv.current_value ?? inv.cost_basis
      const pnl = inv.pnl !== null
        ? ` P&L ${inv.currency === 'USD' ? 'u$s' : '$'}${fmt(inv.pnl)}${inv.pnl_pct !== null ? ` (${inv.pnl_pct >= 0 ? '+' : ''}${inv.pnl_pct.toFixed(2)}%)` : ''}`
        : ''
      return `- [${inv.ticker || inv.name}] ${inv.type} ${inv.broker} ${inv.quantity}u avg ${inv.currency === 'USD' ? 'u$s' : '$'}${fmt(inv.avg_cost)} actual ${inv.current_price !== null ? (inv.currency === 'USD' ? 'u$s' : '$') + fmt(inv.current_price) : 'sin precio'} valor ${inv.currency === 'USD' ? 'u$s' : '$'}${fmt(v)}${pnl}`
    }),
    '=== FIN CARTERA ===',
  ]
  return lines.join('\n')
}

// ── Streaming helper ──────────────────────────────────────────────────────────

async function streamTo(
  url: string,
  body: object,
  onChunk: (t: string) => void,
): Promise<string> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const reader = resp.body!.getReader()
  const dec = new TextDecoder()
  let buf = '', full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') break
      try {
        const { text } = JSON.parse(raw) as { text: string }
        if (text) { full += text; onChunk(full) }
      } catch { /* skip */ }
    }
  }
  return full
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ThinkingDots() {
  const [d, setD] = useState('.')
  useEffect(() => {
    const id = setInterval(() => setD(p => p.length >= 3 ? '.' : p + '.'), 400)
    return () => clearInterval(id)
  }, [])
  return <span className="text-zinc-400 text-sm">{d}</span>
}

function MessageList({
  messages, streaming, endRef,
}: { messages: ChatMessage[]; streaming: boolean; endRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center space-y-2">
          <span className="text-3xl">💬</span>
          <p className="text-sm text-zinc-500">Preguntame sobre tus inversiones</p>
          <p className="text-xs text-zinc-400">Ej: ¿Cómo están mis CEDEARs? ¿Qué bonos convienen hoy?</p>
        </div>
      )}
      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
            msg.role === 'user' ? 'bg-brand-600 text-white rounded-br-sm' : 'bg-zinc-100 text-zinc-800 rounded-bl-sm'
          }`}>
            {msg.text || (streaming && i === messages.length - 1 ? <ThinkingDots /> : '')}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}

function SessionCard({
  session, expanded, onToggle, onDelete,
}: { session: Session; expanded: boolean; onToggle: () => void; onDelete: () => void }) {
  const userMsgs = session.messages.filter(m => m.role === 'user')
  const preview  = userMsgs[0]?.text ?? '(sin mensajes)'
  const dateStr  = new Date(session.ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="bg-zinc-50 rounded-lg border border-zinc-200 overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-100 transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-700 truncate">{preview}</p>
          <p className="text-xs text-zinc-400">{dateStr} · {userMsgs.length} preguntas</p>
        </div>
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          <button onClick={e => { e.stopPropagation(); if (confirm('¿Eliminar sesión?')) onDelete() }}
            className="text-zinc-400 hover:text-red-500 text-sm transition-colors">✕</button>
          <span className="text-zinc-400 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-zinc-200 bg-white">
          {session.summary && (
            <div className="px-3 py-2 bg-brand-50 border-b border-brand-100">
              <p className="text-[10px] font-semibold text-brand-600 uppercase tracking-wider mb-1">Resumen</p>
              <p className="text-xs text-brand-800 leading-relaxed">{session.summary}</p>
            </div>
          )}
          <div className="px-3 py-2 space-y-2 max-h-64 overflow-y-auto">
            {session.messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] px-2 py-1.5 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-zinc-100 text-zinc-700'
                }`}>{m.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InvestmentsAssistant() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions)
  const [activeId, setActiveId] = useState<string>(() => {
    const saved = loadActiveId()
    const all = loadSessions()
    if (saved && all.find(s => s.id === saved)) return saved
    const id = newSessionId()
    const newS: Session = { id, ts: Date.now(), messages: [] }
    saveSessions([...all, newS])
    saveActiveId(id)
    return id
  })
  const [input, setInput]         = useState('')
  const [streaming, setStreaming]  = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [expandedId, setExpandedId]   = useState<string | null>(null)
  const [floatingOpen, setFloatingOpen] = useState(false)

  const chatEndRef  = useRef<HTMLDivElement>(null)
  const floatEndRef = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLInputElement>(null)
  const floatInputRef = useRef<HTMLInputElement>(null)

  const { data: investments = [] } = useQuery({
    queryKey: ['investments'],
    queryFn: () => getInvestments(),
    staleTime: 60_000,
  })

  const activeSession = sessions.find(s => s.id === activeId)
  const messages = activeSession?.messages ?? []

  const updateSession = (id: string, updater: (s: Session) => Session) => {
    setSessions(prev => {
      const next = prev.map(s => s.id === id ? updater(s) : s)
      saveSessions(next)
      return next
    })
  }

  const setMessages = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    updateSession(activeId, s => ({ ...s, messages: updater(s.messages) }))
  }

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { floatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, floatingOpen])
  useEffect(() => { if (floatingOpen) setTimeout(() => floatInputRef.current?.focus(), 100) }, [floatingOpen])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text }, { role: 'assistant', text: '' }])
    setStreaming(true)
    const context = buildPortfolioContext(investments)
    try {
      await streamTo(
        '/api/investments/chat/stream',
        { question: text, context },
        full => setMessages(prev => {
          const u = [...prev]
          u[u.length - 1] = { role: 'assistant', text: full }
          return u
        }),
      )
    } catch {
      setMessages(prev => {
        const u = [...prev]
        u[u.length - 1] = { role: 'assistant', text: 'Error al procesar la consulta.' }
        return u
      })
    } finally {
      setStreaming(false)
    }
  }

  const summarizeSession = async (sessionId: string, sessionMessages: ChatMessage[]) => {
    if (sessionMessages.length === 0) return
    setSummarizing(true)
    try {
      let summary = ''
      await streamTo(
        '/api/analysis/summarize',
        { messages: sessionMessages },
        full => { summary = full },
      )
      if (summary) updateSession(sessionId, s => ({ ...s, summary }))
    } catch { /* ignore */ } finally {
      setSummarizing(false)
    }
  }

  const startNewSession = async () => {
    // Auto-summarize current session before switching (fire-and-forget)
    const curSession = sessions.find(s => s.id === activeId)
    if (curSession && curSession.messages.length > 0 && !curSession.summary) {
      summarizeSession(activeId, curSession.messages)
    }
    const id = newSessionId()
    const newS: Session = { id, ts: Date.now(), messages: [] }
    setSessions(prev => {
      const next = [...prev, newS]
      saveSessions(next)
      return next
    })
    setActiveId(id)
    saveActiveId(id)
    setShowHistory(false)
  }

  const deleteSession = (id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      saveSessions(next)
      return next
    })
    if (id === activeId) {
      const remaining = sessions.filter(s => s.id !== id)
      if (remaining.length > 0) {
        setActiveId(remaining[remaining.length - 1].id)
        saveActiveId(remaining[remaining.length - 1].id)
      } else {
        startNewSession()
      }
    }
  }

  // ── Shared JSX fragments (inlined to avoid remount-on-render bug) ────────────

  const headerJsx = (onExpand?: () => void) => (
    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-base">📊</span>
        <span className="text-sm font-semibold text-zinc-900">Asistente Inversiones</span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">WIP</span>
        {investments.length > 0 && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
            title="El asistente ve tu cartera actual">
            {investments.length} pos.
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {messages.length > 0 && (
          <button
            onClick={() => summarizeSession(activeId, messages)}
            disabled={summarizing}
            className="text-xs px-2 py-1 rounded border border-brand-200 bg-brand-50 text-brand-600 hover:bg-brand-100 disabled:opacity-50 transition-colors"
            title="Generar resumen de la sesión para retomar después"
          >
            {summarizing ? '...' : 'Resumir'}
          </button>
        )}
        {onExpand && (
          <button onClick={onExpand} className="text-zinc-400 hover:text-zinc-700 transition-colors p-1 rounded" title="Expandir">
            ⤢
          </button>
        )}
      </div>
    </div>
  )

  const toolbarJsx = (
    <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-100 flex-shrink-0">
      <div className="flex items-center gap-3">
        <button onClick={() => setShowHistory(false)}
          className={`text-xs font-medium transition-colors ${!showHistory ? 'text-brand-600' : 'text-zinc-400 hover:text-zinc-600'}`}>
          Chat
        </button>
        <button onClick={() => setShowHistory(true)}
          className={`text-xs font-medium transition-colors ${showHistory ? 'text-brand-600' : 'text-zinc-400 hover:text-zinc-600'}`}>
          Historial {sessions.length > 0 && <span className="ml-1 text-zinc-400">({sessions.length})</span>}
        </button>
      </div>
      {!showHistory && (
        <button onClick={startNewSession} className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
          + Nueva sesión
        </button>
      )}
    </div>
  )

  const historyJsx = (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
      {sessions.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-8">Sin historial aún</p>
      ) : (
        [...sessions].reverse().map(s => (
          <div key={s.id} className="relative">
            {s.id === activeId && (
              <span className="absolute -top-1 -right-1 z-10 text-[9px] font-bold px-1.5 py-0.5 bg-brand-600 text-white rounded-full">
                activa
              </span>
            )}
            <SessionCard
              session={s}
              expanded={expandedId === s.id}
              onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
              onDelete={() => deleteSession(s.id)}
            />
          </div>
        ))
      )}
    </div>
  )

  const inputBarJsx = (iRef: React.RefObject<HTMLInputElement>) => (
    <div className="px-4 py-3 border-t border-zinc-200 flex-shrink-0">
      {activeSession?.summary && (
        <div className="mb-2 px-3 py-2 bg-brand-50 border border-brand-100 rounded-lg">
          <p className="text-[10px] font-semibold text-brand-600 uppercase tracking-wider mb-0.5">Resumen de sesión</p>
          <p className="text-xs text-brand-700 leading-relaxed line-clamp-3">{activeSession.summary}</p>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input ref={iRef} type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Preguntá sobre tus inversiones..."
          disabled={streaming}
          className="flex-1 border border-zinc-300 bg-white rounded-xl px-4 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 disabled:opacity-50"
        />
        <button onClick={sendMessage} disabled={!input.trim() || streaming}
          className="w-9 h-9 bg-brand-600 hover:bg-brand-500 text-white rounded-xl flex items-center justify-center disabled:opacity-40 transition-colors flex-shrink-0">
          <span className="text-sm">↑</span>
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Fixed side panel */}
      <div className="fixed top-0 right-0 h-full w-full sm:w-[360px] bg-white border-l border-zinc-200 shadow-lg z-30 flex flex-col">
        {headerJsx(() => setFloatingOpen(true))}
        {toolbarJsx}
        {showHistory ? historyJsx : <MessageList messages={messages} streaming={streaming} endRef={chatEndRef} />}
        {!showHistory && inputBarJsx(inputRef)}
      </div>

      {/* Floating modal */}
      {floatingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setFloatingOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-2xl" style={{ height: '80vh' }}>
            {headerJsx()}
            {toolbarJsx}
            {showHistory ? historyJsx : <MessageList messages={messages} streaming={streaming} endRef={floatEndRef} />}
            {!showHistory && inputBarJsx(floatInputRef)}
          </div>
        </div>
      )}
    </>
  )
}
