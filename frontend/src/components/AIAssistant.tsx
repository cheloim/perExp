import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDashboardAITrends } from '../api/client'
import type { AITrendsResponse } from '../types'

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

const SESSIONS_KEY = 'ai_assistant_sessions'
const ACTIVE_KEY   = 'ai_assistant_active'

function loadSessions(): Session[] {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]') } catch { return [] }
}
function saveSessions(s: Session[]) {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(s.slice(-30))) } catch {}
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

async function streamTo(url: string, body: object, onChunk: (full: string) => void): Promise<string> {
  const token = localStorage.getItem('auth_token')
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
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
      } catch {}
    }
  }
  return full
}

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

  const trendColor = data?.trend === 'up' ? 'text-[var(--gnome-red-3)]' : data?.trend === 'down' ? 'text-[var(--gnome-green-5)]' : 'text-[var(--text-tertiary)]'
  const trendIcon  = data?.trend === 'up' ? '↑' : data?.trend === 'down' ? '↓' : '→'
  const trendLabel = data?.trend === 'up' ? 'Tendencia alcista' : data?.trend === 'down' ? 'Tendencia bajista' : 'Estable'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Resumen del mes</span>
        {data && <span className={`text-xs font-bold ${trendColor}`}>{trendIcon} {trendLabel}</span>}
      </div>
      {!data && !isLoading && (
        <button
          onClick={() => { setEnabled(true); refetch() }}
          className="w-full py-2 text-sm font-medium text-white bg-[var(--color-primary)] hover:brightness-110 rounded-md transition-colors"
        >
          ✨ Analizar gastos del mes
        </button>
      )}
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[var(--color-primary)]" />
          <span className="ml-2 text-sm text-[var(--text-tertiary)]">Analizando...</span>
        </div>
      )}
      {data && (
        <div className="space-y-2 text-sm">
          {data.trend_explanation && <p className="text-[var(--text-secondary)] leading-relaxed">{data.trend_explanation}</p>}
          {data.top_rising_category  && <p className="text-[var(--gnome-red-3)] text-xs">↑ Subió: {data.top_rising_category}</p>}
          {data.top_falling_category && <p className="text-[var(--gnome-green-5)] text-xs">↓ Bajó: {data.top_falling_category}</p>}
          {data.recommendation && (
            <div className="alert-info text-xs">{data.recommendation}</div>
          )}
          {data.alert && (
            <div className="alert-warning text-xs font-medium">⚠ {data.alert}</div>
          )}
          <button onClick={() => refetch()} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
            Actualizar análisis
          </button>
        </div>
      )}
    </div>
  )
}

function ThinkingDots() {
  const [d, setD] = useState('.')
  useEffect(() => {
    const id = setInterval(() => setD(p => p.length >= 3 ? '.' : p + '.'), 400)
    return () => clearInterval(id)
  }, [])
  return <span className="text-[var(--text-tertiary)] text-sm">{d}</span>
}

function SessionCard({
  session, expanded, onToggle, onDelete, isActive,
}: { session: Session; expanded: boolean; onToggle: () => void; onDelete: () => void; isActive: boolean }) {
  const userMsgs = session.messages.filter(m => m.role === 'user')
  const preview  = userMsgs[0]?.text ?? '(sin mensajes)'
  const dateStr  = new Date(session.ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className={`rounded-md border overflow-hidden relative ${isActive ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5' : 'border-[var(--border-color)] bg-[var(--color-base-alt)]'}`}>
      {isActive && (
        <span className="absolute top-1.5 right-7 text-[9px] font-bold px-1.5 py-0.5 bg-[var(--color-primary)] text-white rounded-full z-10">
          activa
        </span>
      )}
      <div className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[var(--color-base-alt)]/80 transition-colors" onClick={onToggle}>
        <div className="flex-1 min-w-0 pr-8">
          <p className="text-sm text-[var(--text-primary)] truncate">{preview}</p>
          <p className="text-xs text-[var(--text-tertiary)]">{dateStr} · {userMsgs.length} preguntas</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={e => { e.stopPropagation(); if (confirm('¿Eliminar sesión?')) onDelete() }}
            className="text-[var(--text-tertiary)] hover:text-[var(--gnome-red-3)] text-sm transition-colors">✕</button>
          <span className="text-[var(--text-tertiary)] text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-[var(--border-color)] bg-[var(--color-surface)]">
          {session.summary && (
            <div className="px-3 py-2 bg-[var(--color-primary)]/8 border-b border-[var(--border-color)]">
              <p className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-1">Resumen</p>
              <p className="text-xs text-[var(--text-primary)] leading-relaxed">{session.summary}</p>
            </div>
          )}
          <div className="px-3 py-2 space-y-2 max-h-56 overflow-y-auto">
            {session.messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] px-2.5 py-2 rounded-md text-xs leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-base-alt)] text-[var(--text-primary)]'
                }`}>{m.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

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
    updateSession(activeId, s => ({ ...s, messages: updater(s.messages), lastMessageTs: Date.now() }))
  }

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 300) }, [open])

  useEffect(() => {
    const checkInactivity = () => {
      const session = sessions.find(s => s.id === activeId)
      if (!session || session.messages.length === 0) return
      const lastTs = session.lastMessageTs ?? session.ts
      const hoursSinceLastMessage = (Date.now() - lastTs) / (1000 * 60 * 60)
      if (hoursSinceLastMessage > 2) {
        const curSession = sessions.find(s => s.id === activeId)
        if (curSession && curSession.messages.length > 0 && !curSession.summary) {
          summarizeSession(activeId, curSession.messages)
        }
        const id = newSessionId()
        const s: Session = { id, ts: Date.now(), messages: [] }
        setSessions(prev => { const next = [...prev, s]; saveSessions(next); return next })
        setActiveId(id); saveActiveId(id)
        setShowHistory(false)
      }
    }
    const interval = setInterval(checkInactivity, 60_000)
    return () => clearInterval(interval)
  }, [sessions, activeId])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text }, { role: 'assistant', text: '' }])
    setStreaming(true)
    try {
      await streamTo('/api/analysis/stream', { month: currentMonth, question: text }, full =>
        setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', text: full }; return u })
      )
    } catch {
      setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', text: 'Error al procesar la consulta.' }; return u })
    } finally {
      setStreaming(false)
    }
  }

  const summarizeSession = async (sessionId: string, sessionMessages: ChatMessage[]) => {
    if (sessionMessages.length === 0) return
    setSummarizing(true)
    try {
      let summary = ''
      await streamTo('/api/analysis/summarize', { messages: sessionMessages }, full => { summary = full })
      if (summary) updateSession(sessionId, s => ({ ...s, summary }))
    } catch {} finally {
      setSummarizing(false)
    }
  }

  const startNewSession = () => {
    const curSession = sessions.find(s => s.id === activeId)
    if (curSession && curSession.messages.length > 0 && !curSession.summary) {
      summarizeSession(activeId, curSession.messages)
    }
    const id = newSessionId()
    const s: Session = { id, ts: Date.now(), messages: [] }
    setSessions(prev => { const next = [...prev, s]; saveSessions(next); return next })
    setActiveId(id); saveActiveId(id)
    setShowHistory(false)
  }

  const deleteSession = (id: string) => {
    setSessions(prev => { const next = prev.filter(s => s.id !== id); saveSessions(next); return next })
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
    <div className="fixed top-0 right-0 h-full w-full sm:w-[380px] bg-[var(--color-surface)] border-l border-[var(--border-color)] shadow-gnome-lg z-30 flex flex-col">

      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="text-[var(--color-primary)]">
            <path d="M10 2l2.5 5 5.5.8-4 3.9.95 5.5L10 14.75l-4.95 2.45.95-5.5-4-3.9 5.5-.8L10 2z" fill="currentColor"/>
          </svg>
          <span className="text-base font-semibold text-[var(--text-primary)]">Asistente IA</span>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button onClick={() => summarizeSession(activeId, messages)} disabled={summarizing}
              className="text-xs px-2 py-1 rounded border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/8 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/15 disabled:opacity-50 transition-colors">
              {summarizing ? '...' : 'Resumir'}
            </button>
          )}
          <button onClick={onToggle}
            className="flex items-center justify-center w-9 h-9 bg-[var(--color-primary)] hover:brightness-110 text-white rounded-full shadow-gnome transition-all">
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col min-h-0">

        <div className="px-5 py-4 border-b border-[var(--border-color)] flex-shrink-0">
          <TrendsSection />
        </div>

        <div className="flex items-center justify-between px-5 py-2 border-b border-[var(--border-color)] flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowHistory(false)}
              className={`text-xs font-medium uppercase tracking-wider transition-colors ${!showHistory ? 'text-[var(--color-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}>
              Chat
            </button>
            <button onClick={() => setShowHistory(true)}
              className={`text-xs font-medium uppercase tracking-wider transition-colors ${showHistory ? 'text-[var(--color-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}>
              Historial {sessions.filter(s => s.id !== activeId).length > 0 && <span className="ml-1 text-[var(--text-tertiary)]">({sessions.filter(s => s.id !== activeId).length})</span>}
            </button>
          </div>
          {!showHistory && (
            <button onClick={startNewSession} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
              + Nueva sesión
            </button>
          )}
        </div>

        {showHistory ? (
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2 min-h-0">
            {sessions.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)] text-center py-8">Sin historial aún</p>
            ) : (
              [...sessions].reverse().filter(s => s.id !== activeId).map(s => (
                <SessionCard key={s.id} session={s} expanded={expandedId === s.id}
                  onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  onDelete={() => deleteSession(s.id)} isActive={false} />
              ))
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col px-5 py-4 space-y-3 min-h-0 overflow-y-auto">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-2">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[var(--text-tertiary)]">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
                <p className="text-sm text-[var(--text-secondary)]">Preguntame sobre tus gastos del mes</p>
                <p className="text-xs text-[var(--text-tertiary)]">Ej: ¿Dónde gasté más? ¿Cómo reduzco mis gastos en comida?</p>
              </div>
            )}
            <div className="flex-1 space-y-3 overflow-y-auto min-h-0">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-3 py-2 rounded-md text-sm leading-relaxed ${
                    msg.role === 'user' ? 'bg-[var(--color-primary)] text-white rounded-br-sm' : 'bg-[var(--color-base-alt)] text-[var(--text-primary)] rounded-bl-sm'
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

      {!showHistory && (
        <div className="px-4 py-3 border-t border-[var(--border-color)] flex-shrink-0">
          {activeSession?.summary && (
            <div className="mb-2 px-3 py-2 bg-[var(--color-primary)]/8 border border-[var(--color-primary)]/20 rounded-md">
              <p className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-0.5">Resumen de sesión</p>
              <p className="text-xs text-[var(--text-primary)] leading-relaxed line-clamp-3">{activeSession.summary}</p>
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
              className="flex-1 border border-[var(--border-color)] bg-[var(--color-base-container)] rounded-md px-4 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20 disabled:opacity-50"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || streaming}
              className="w-9 h-9 bg-[var(--color-primary)] hover:brightness-110 text-white rounded-md flex items-center justify-center disabled:opacity-40 transition-colors flex-shrink-0"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M2 8l12-6-3 6 3 6-12-6z" fill="currentColor"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}