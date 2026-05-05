import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDashboardAITrends } from '../api/client'
import type { AITrendsResponse } from '../types'

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

interface Session {
  id: string
  ts: number
  messages: ChatMessage[]
  summary?: string
}

// ── Storage ──────────────────────────────────────────────────────────────────

const SESSIONS_KEY = 'ai_assistant_sessions'
const ACTIVE_KEY   = 'ai_assistant_active'

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

// ── Streaming helper ──────────────────────────────────────────────────────────

async function streamTo(
  url: string,
  body: object,
  onChunk: (full: string) => void,
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

// ── Trends section ────────────────────────────────────────────────────────────

function TrendsSection() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [enabled, setEnabled] = useState(false)
  const { data, isLoading, refetch } = useQuery<AITrendsResponse>({
    queryKey: ['ai-trends-drawer', currentMonth],
    queryFn: () => getDashboardAITrends({ month: currentMonth }),
    enabled,
    staleTime: 5 * 60 * 1000,
  })

  const trendColor = data?.trend === 'up' ? 'text-red-500' : data?.trend === 'down' ? 'text-emerald-600' : 'text-zinc-500'
  const trendIcon  = data?.trend === 'up' ? '↑' : data?.trend === 'down' ? '↓' : '→'
  const trendLabel = data?.trend === 'up' ? 'Tendencia alcista' : data?.trend === 'down' ? 'Tendencia bajista' : 'Estable'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Resumen del mes</span>
        {data && <span className={`text-xs font-bold ${trendColor}`}>{trendIcon} {trendLabel}</span>}
      </div>
      {!data && !isLoading && (
        <button
          onClick={() => { setEnabled(true); refetch() }}
          className="w-full py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-500 rounded-lg transition-colors"
        >
          ✨ Analizar gastos del mes
        </button>
      )}
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-brand-500" />
          <span className="ml-2 text-sm text-zinc-500">Analizando...</span>
        </div>
      )}
      {data && (
        <div className="space-y-2 text-sm">
          {data.trend_explanation && <p className="text-zinc-700 leading-relaxed">{data.trend_explanation}</p>}
          {data.top_rising_category  && <p className="text-red-500 text-xs">↑ Subió: {data.top_rising_category}</p>}
          {data.top_falling_category && <p className="text-emerald-600 text-xs">↓ Bajó: {data.top_falling_category}</p>}
          {data.recommendation && (
            <p className="text-brand-600 text-xs bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{data.recommendation}</p>
          )}
          {data.alert && (
            <p className="text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-medium">⚠ {data.alert}</p>
          )}
          <button onClick={() => refetch()} className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
            Actualizar análisis
          </button>
        </div>
      )}
    </div>
  )
}

// ── ThinkingDots ──────────────────────────────────────────────────────────────

function ThinkingDots() {
  const [d, setD] = useState('.')
  useEffect(() => {
    const id = setInterval(() => setD(p => p.length >= 3 ? '.' : p + '.'), 400)
    return () => clearInterval(id)
  }, [])
  return <span className="text-zinc-400 text-sm">{d}</span>
}

// ── SessionCard ───────────────────────────────────────────────────────────────

function SessionCard({
  session, expanded, onToggle, onDelete, isActive,
}: { session: Session; expanded: boolean; onToggle: () => void; onDelete: () => void; isActive: boolean }) {
  const userMsgs = session.messages.filter(m => m.role === 'user')
  const preview  = userMsgs[0]?.text ?? '(sin mensajes)'
  const dateStr  = new Date(session.ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className={`rounded-lg border overflow-hidden relative ${isActive ? 'border-brand-200 bg-brand-50/30' : 'border-zinc-200 bg-zinc-50'}`}>
      {isActive && (
        <span className="absolute top-1.5 right-7 text-[9px] font-bold px-1.5 py-0.5 bg-brand-600 text-white rounded-full z-10">
          activa
        </span>
      )}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-100/60 transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0 pr-8">
          <p className="text-sm text-zinc-700 truncate">{preview}</p>
          <p className="text-xs text-zinc-400">{dateStr} · {userMsgs.length} preguntas</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
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
          <div className="px-3 py-2 space-y-2 max-h-56 overflow-y-auto">
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

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AIAssistant({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [sessions, setSessions] = useState<Session[]>(loadSessions)
  const [activeId, setActiveId] = useState<string>(() => {
    const saved = loadActiveId()
    const all = loadSessions()
    if (saved && all.find(s => s.id === saved)) return saved
    const id = newSessionId()
    const s: Session = { id, ts: Date.now(), messages: [] }
    saveSessions([...all, s])
    saveActiveId(id)
    return id
  })
  const [input, setInput]             = useState('')
  const [streaming, setStreaming]     = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [expandedId, setExpandedId]   = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)

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
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 300) }, [open])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text }, { role: 'assistant', text: '' }])
    setStreaming(true)
    try {
      await streamTo(
        'http://localhost:8000/analysis/stream',
        { month: currentMonth, question: text },
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
        'http://localhost:8000/analysis/summarize',
        { messages: sessionMessages },
        full => { summary = full },
      )
      if (summary) updateSession(sessionId, s => ({ ...s, summary }))
    } catch { /* ignore */ } finally {
      setSummarizing(false)
    }
  }

  const startNewSession = () => {
    // Auto-summarize current session before switching (fire-and-forget)
    const curSession = sessions.find(s => s.id === activeId)
    if (curSession && curSession.messages.length > 0 && !curSession.summary) {
      summarizeSession(activeId, curSession.messages)
    }
    const id = newSessionId()
    const s: Session = { id, ts: Date.now(), messages: [] }
    setSessions(prev => { const next = [...prev, s]; saveSessions(next); return next })
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
        const last = remaining[remaining.length - 1]
        setActiveId(last.id); saveActiveId(last.id)
      } else {
        startNewSession()
      }
    }
  }

  if (!open) return null

  return (
    <div className="fixed top-0 right-0 h-full w-full sm:w-[380px] bg-white border-l border-zinc-200 shadow-lg z-30 flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">✨</span>
          <span className="text-base font-semibold text-zinc-900">Asistente IA</span>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={() => summarizeSession(activeId, messages)}
              disabled={summarizing}
              className="text-xs px-2 py-1 rounded border border-brand-200 bg-brand-50 text-brand-600 hover:bg-brand-100 disabled:opacity-50 transition-colors"
              title="Resumir sesión para retomar después"
            >
              {summarizing ? '...' : 'Resumir'}
            </button>
          )}
          <button
            onClick={onToggle}
            className="flex items-center justify-center w-9 h-9 bg-brand-600 hover:bg-brand-500 text-white rounded-full shadow-md transition-all"
            title="Cerrar asistente"
          >
            <span className="text-base leading-none">✕</span>
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto flex flex-col min-h-0">

        {/* Trends */}
        <div className="px-5 py-4 border-b border-zinc-100 flex-shrink-0">
          <TrendsSection />
        </div>

        {/* Chat / History toolbar */}
        <div className="flex items-center justify-between px-5 py-2 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowHistory(false)}
              className={`text-xs font-semibold uppercase tracking-wider transition-colors ${!showHistory ? 'text-brand-600' : 'text-zinc-400 hover:text-zinc-600'}`}>
              Chat
            </button>
            <button onClick={() => setShowHistory(true)}
              className={`text-xs font-semibold uppercase tracking-wider transition-colors ${showHistory ? 'text-brand-600' : 'text-zinc-400 hover:text-zinc-600'}`}>
              Historial {sessions.length > 0 && <span className="ml-1 text-zinc-400">({sessions.length})</span>}
            </button>
          </div>
          {!showHistory && (
            <button onClick={startNewSession} className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
              + Nueva sesión
            </button>
          )}
        </div>

        {/* History view */}
        {showHistory ? (
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2 min-h-0">
            {sessions.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">Sin historial aún</p>
            ) : (
              [...sessions].reverse().map(s => (
                <SessionCard
                  key={s.id}
                  session={s}
                  expanded={expandedId === s.id}
                  onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  onDelete={() => deleteSession(s.id)}
                  isActive={s.id === activeId}
                />
              ))
            )}
          </div>
        ) : (
          /* Chat view */
          <div className="flex-1 flex flex-col px-5 py-4 space-y-3 min-h-0 overflow-y-auto">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-2">
                <span className="text-3xl">💬</span>
                <p className="text-sm text-zinc-500">Preguntame sobre tus gastos del mes</p>
                <p className="text-xs text-zinc-400">Ej: ¿Dónde gasté más? ¿Cómo reduzco mis gastos en comida?</p>
              </div>
            )}
            <div className="flex-1 space-y-3 overflow-y-auto min-h-0">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user' ? 'bg-brand-600 text-white rounded-br-sm' : 'bg-zinc-100 text-zinc-800 rounded-bl-sm'
                  }`}>
                    {msg.text || (streaming && i === messages.length - 1 ? <ThinkingDots /> : '')}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      {!showHistory && (
        <div className="px-4 py-3 border-t border-zinc-200 flex-shrink-0">
          {activeSession?.summary && (
            <div className="mb-2 px-3 py-2 bg-brand-50 border border-brand-100 rounded-lg">
              <p className="text-[10px] font-semibold text-brand-600 uppercase tracking-wider mb-0.5">Resumen de sesión</p>
              <p className="text-xs text-brand-700 leading-relaxed line-clamp-3">{activeSession.summary}</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Preguntá sobre tus gastos..."
              disabled={streaming}
              className="flex-1 border border-zinc-300 bg-white rounded-xl px-4 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 disabled:opacity-50"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || streaming}
              className="w-9 h-9 bg-brand-600 hover:bg-brand-500 text-white rounded-xl flex items-center justify-center disabled:opacity-40 transition-colors flex-shrink-0"
            >
              <span className="text-sm">↑</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
