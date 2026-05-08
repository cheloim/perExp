import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getInvestments } from '../api/client'
import { usePanelWidth } from '../context/PanelWidthContext'
import type { Investment } from '../types'

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

interface Session {
  id: string
  ts: number
  lastMessageTs?: number
  messages: ChatMessage[]
  summary?: string
}

// ── Storage ──────────────────────────────────────────────────────────────────

const SESSIONS_KEY = 'inv_assistant_sessions'
const ACTIVE_KEY   = 'inv_assistant_active'

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
  const token = localStorage.getItem('auth_token')
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
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

// ── SVG Icons ──────────────────────────────────────────────────────────────────

function ChatBubbleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function NewChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  )
}

function SummaryIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ThinkingDots() {
  const [d, setD] = useState('.')
  useEffect(() => {
    const id = setInterval(() => setD(p => p.length >= 3 ? '.' : p + '.'), 400)
    return () => clearInterval(id)
  }, [])
  return <span className="text-tertiary text-sm">{d}</span>
}

function MessageList({
  messages, streaming, endRef,
}: { messages: ChatMessage[]; streaming: boolean; endRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center space-y-2">
          <span className="text-secondary"><ChatBubbleIcon /></span>
          <p className="text-sm text-secondary">Preguntame sobre tus inversiones</p>
          <p className="text-xs text-tertiary">Ej: ¿Cómo están mis CEDEARs? ¿Qué bonos convienen hoy?</p>
        </div>
      )}
      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
            msg.role === 'user'
              ? 'bg-primary text-on-primary rounded-br-sm'
              : 'bg-base-alt text-primary rounded-bl-sm'
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
    <div className="bg-base-container border border-border-color rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-base-alt transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm text-primary truncate">{preview}</p>
          <p className="text-xs text-tertiary">{dateStr} · {userMsgs.length} preguntas</p>
        </div>
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          <button onClick={e => { e.stopPropagation(); if (confirm('¿Eliminar sesión?')) onDelete() }}
            className="text-tertiary hover:text-danger text-sm transition-colors"><TrashIcon /></button>
          <span className="text-tertiary text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border-color bg-surface">
          {session.summary && (
            <div className="px-3 py-2 bg-primary-subtle border-b border-border-color">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1 flex items-center gap-1">
                <SummaryIcon /> Resumen
              </p>
              <p className="text-xs text-primary leading-relaxed">{session.summary}</p>
            </div>
          )}
          <div className="px-3 py-2 space-y-2 max-h-64 overflow-y-auto">
            {session.messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] px-2 py-1.5 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-primary text-on-primary' : 'bg-base-alt text-primary'
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

const PANEL_MIN_WIDTH = 180
const PANEL_DEFAULT_WIDTH = 360
const COLLAPSE_THRESHOLD = 200

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

  const { panelWidth: contextWidth, isCollapsed: contextCollapsed, setPanelWidth, setIsCollapsed } = usePanelWidth()
  const [panelWidth, setPanelWidthLocal] = useState(PANEL_DEFAULT_WIDTH)
  const [isCollapsed, setIsCollapsedLocal] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (contextWidth !== panelWidth) setPanelWidthLocal(contextWidth)
  }, [contextWidth])
  useEffect(() => {
    if (contextCollapsed !== isCollapsed) setIsCollapsedLocal(contextCollapsed)
  }, [contextCollapsed])

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

  const startDrag = useRef<number | null>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isCollapsed) return
    e.preventDefault()
    setIsDragging(true)
    startDrag.current = e.clientX
  }

  useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e: MouseEvent) => {
      if (startDrag.current === null) return
      const delta = startDrag.current - e.clientX
      const newWidth = Math.max(PANEL_MIN_WIDTH, Math.min(window.innerWidth - 100, panelWidth + delta))
      setPanelWidthLocal(newWidth)
      setPanelWidth(newWidth)
      startDrag.current = e.clientX
      if (newWidth < COLLAPSE_THRESHOLD) {
        setIsCollapsedLocal(true)
        setIsCollapsed(true)
        setIsDragging(false)
      }
    }
    const handleMouseUp = () => {
      setIsDragging(false)
      startDrag.current = null
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, panelWidth])

  const expandPanel = () => {
    setIsCollapsedLocal(false)
    setIsCollapsed(false)
    setPanelWidthLocal(PANEL_DEFAULT_WIDTH)
    setPanelWidth(PANEL_DEFAULT_WIDTH)
  }

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

  // ── Shared JSX fragments ────────────────────────────────────────────────────

  const headerJsx = (onExpand?: () => void) => (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border-color flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-secondary"><ChartIcon /></span>
        <span className="text-sm font-semibold text-primary">Asistente Inversiones</span>
        <span className="badge-warning text-[10px]">WIP</span>
        {investments.length > 0 && (
          <span className="badge-primary text-[10px]"
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
            className="text-xs px-2 py-1 rounded border border-border-color bg-base-alt text-secondary hover:bg-base-container disabled:opacity-50 transition-colors"
            title="Generar resumen de la sesión"
          >
            {summarizing ? '...' : 'Resumir'}
          </button>
        )}
        {onExpand && (
          <button onClick={onExpand} className="text-tertiary hover:text-primary transition-colors p-1 rounded" title="Expandir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
          </button>
        )}
      </div>
    </div>
  )

  const toolbarJsx = (
    <div className="flex items-center justify-between px-4 py-2 border-b border-border-color flex-shrink-0">
      <div className="flex items-center gap-3">
        <button onClick={() => setShowHistory(false)}
          className={`text-xs font-medium transition-colors ${!showHistory ? 'text-primary' : 'text-tertiary hover:text-primary'}`}>
          Chat
        </button>
        <button onClick={() => setShowHistory(true)}
          className={`text-xs font-medium transition-colors ${showHistory ? 'text-primary' : 'text-tertiary hover:text-primary'}`}>
          Historial {sessions.filter(s => s.id !== activeId).length > 0 && <span className="ml-1 text-tertiary">({sessions.filter(s => s.id !== activeId).length})</span>}
        </button>
      </div>
      {!showHistory && (
        <button onClick={startNewSession} className="text-xs text-tertiary hover:text-primary transition-colors flex items-center gap-1">
          <NewChatIcon /> Nueva sesión
        </button>
      )}
    </div>
  )

  const historyJsx = (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
      {sessions.length === 0 ? (
        <p className="text-sm text-secondary text-center py-8">Sin historial aún</p>
      ) : (
        [...sessions].reverse().filter(s => s.id !== activeId).map(s => (
          <SessionCard
            key={s.id}
            session={s}
            expanded={expandedId === s.id}
            onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
            onDelete={() => deleteSession(s.id)}
            />
        ))
      )}
    </div>
  )

  const inputBarJsx = (iRef: React.RefObject<HTMLInputElement>) => (
    <div className="px-4 py-3 border-t border-border-color flex-shrink-0">
      {activeSession?.summary && (
        <div className="mb-2 px-3 py-2 bg-primary-subtle border border-border-color rounded-lg">
          <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-0.5 flex items-center gap-1"><SummaryIcon /> Resumen de sesión</p>
          <p className="text-xs text-primary leading-relaxed line-clamp-3">{activeSession.summary}</p>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input ref={iRef} type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Preguntá sobre tus inversiones..."
          disabled={streaming}
          className="flex-1 input text-sm"
        />
        <button onClick={sendMessage} disabled={!input.trim() || streaming}
          className="w-9 h-9 bg-primary text-on-primary hover:brightness-110 rounded-xl flex items-center justify-center disabled:opacity-40 transition-colors flex-shrink-0">
          <SendIcon />
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Fixed side panel */}
      {!isCollapsed ? (
        <div
          className={`fixed top-0 right-0 h-full bg-surface border-l border-border-color shadow-lg z-30 flex flex-col transition-all duration-200 ease-out ${isDragging ? '' : 'will-change-[width]'}`}
          style={{ width: panelWidth }}
        >
          {/* Drag handle - left edge */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-primary/20 transition-colors flex items-center justify-center"
            onMouseDown={handleMouseDown}
          >
            <div className="w-0.5 h-12 bg-border-color rounded-full hover:bg-primary transition-colors" />
          </div>

          {/* Collapse button */}
          <button
            onClick={() => { setIsCollapsedLocal(true); setIsCollapsed(true) }}
            className="absolute -left-3 top-1/2 -translate-y-1/2 w-5 h-12 bg-surface border border-border-color rounded-l-md flex items-center justify-center text-tertiary hover:text-primary hover:bg-base-alt transition-all z-30"
            title="Contraer panel"
          >
            <ChevronRightIcon />
          </button>

          {headerJsx(() => setFloatingOpen(true))}
          {toolbarJsx}
          {showHistory ? historyJsx : <MessageList messages={messages} streaming={streaming} endRef={chatEndRef} />}
          {!showHistory && inputBarJsx(inputRef)}
        </div>
      ) : (
        /* Collapsed state - floating button */
        <button
          onClick={expandPanel}
          className="fixed right-0 top-1/2 -translate-y-1/2 w-10 h-20 bg-primary hover:brightness-110 rounded-l-xl shadow-lg flex items-center justify-center text-on-primary transition-all duration-300 ease-out hover:w-12 z-40 group"
          title="Abrir Asistente de Inversiones"
        >
          <div className="flex flex-col items-center gap-1">
            <BoltIcon />
            <span className="text-[8px] font-medium uppercase tracking-wider opacity-80">Inv</span>
          </div>
          <div className="absolute -left-1 w-1 h-4 bg-white/30 rounded-full group-hover:h-6 transition-all" />
        </button>
      )}

      {/* Floating modal */}
      {floatingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setFloatingOpen(false)} />
          <div className="relative bg-surface rounded-xl shadow-2xl flex flex-col w-full max-w-2xl" style={{ height: '80vh' }}>
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
