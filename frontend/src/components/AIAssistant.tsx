import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDashboardAITrends, getAnalysisHistory, deleteAnalysisHistory } from '../api/client'
import type { AITrendsResponse, AnalysisHistory } from '../types'

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

const CHAT_HISTORY_KEY = 'ai_assistant_chat_history'

function formatDate(iso: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function loadChatHistory(): ChatMessage[] {
  try {
    const saved = localStorage.getItem(CHAT_HISTORY_KEY)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

function saveChatHistory(messages: ChatMessage[]) {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages))
  } catch {
    // ignore storage errors
  }
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
          {data.top_rising_category && (
            <p className="text-red-500 text-xs">↑ Subió: {data.top_rising_category}</p>
          )}
          {data.top_falling_category && (
            <p className="text-emerald-600 text-xs">↓ Bajó: {data.top_falling_category}</p>
          )}
          {data.recommendation && (
            <p className="text-brand-600 text-xs bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{data.recommendation}</p>
          )}
          {data.alert && (
            <p className="text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-medium">⚠ {data.alert}</p>
          )}
          <button
            onClick={() => refetch()}
            className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            Actualizar análisis
          </button>
        </div>
      )}
    </div>
  )
}

export default function AIAssistant({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const qc = useQueryClient()
  const [messages, setMessages] = useState<ChatMessage[]>(loadChatHistory)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: history = [] } = useQuery({
    queryKey: ['analysis-history'],
    queryFn: getAnalysisHistory,
    enabled: showHistory,
  })

  const deleteMut = useMutation({
    mutationFn: deleteAnalysisHistory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analysis-history'] }),
  })

  // Save chat history whenever messages change
  useEffect(() => {
    saveChatHistory(messages)
  }, [messages])

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300)
  }, [open])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text }])

    let assistantText = ''
    setMessages(prev => [...prev, { role: 'assistant', text: '' }])
    setStreaming(true)

    try {
      const response = await fetch('http://localhost:8000/analysis/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: currentMonth || null, question: text }),
      })
      if (!response.ok) throw new Error(`Error ${response.status}`)

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim()
            if (raw === '[DONE]') break
            try {
              const { text: chunk } = JSON.parse(raw) as { text: string }
              if (chunk) {
                assistantText += chunk
                setMessages(prev => {
                  const updated = [...prev]
                  updated[updated.length - 1] = { role: 'assistant', text: assistantText }
                  return updated
                })
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (e) {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', text: 'Error al procesar la consulta.' }
        return updated
      })
    } finally {
      setStreaming(false)
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
          <button
            onClick={onToggle}
            className="flex items-center justify-center w-11 h-11 bg-brand-600 hover:bg-brand-500 text-white rounded-full shadow-md hover:shadow-lg transition-all duration-200"
            title="Cerrar asistente IA"
          >
            <span className="text-lg leading-none">✕</span>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Trends section */}
          <div className="px-5 py-4 border-b border-zinc-100">
            <TrendsSection />
          </div>

          {/* Chat section */}
          <div className="flex-1 flex flex-col px-5 py-4 space-y-3 min-h-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Consultas sobre tus gastos</span>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
              >
                {showHistory ? 'Ocultar historial' : 'Ver historial'}
              </button>
            </div>

            {showHistory ? (
              <div className="flex-1 space-y-2 overflow-y-auto">
                {history.length === 0 ? (
                  <p className="text-sm text-zinc-500 text-center py-8">No hay historial guardado</p>
                ) : (
                  history.map((h: AnalysisHistory) => (
                    <div
                      key={h.id}
                      className="bg-zinc-50 rounded-lg border border-zinc-200 overflow-hidden"
                    >
                      <div
                        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-100 transition-colors"
                        onClick={() => setExpandedHistoryId(expandedHistoryId === h.id ? null : h.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-zinc-700 truncate">
                            {h.question || `Análisis del ${h.month || 'período completo'}`}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {formatDate(h.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (confirm('¿Eliminar este análisis?')) deleteMut.mutate(h.id)
                            }}
                            className="text-zinc-400 hover:text-red-500 text-sm transition-colors"
                          >
                            ✕
                          </button>
                          <span className="text-zinc-400 text-xs">{expandedHistoryId === h.id ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      {expandedHistoryId === h.id && (
                        <div className="px-3 py-3 border-t border-zinc-200 bg-white text-sm text-zinc-700 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                          {h.result_text}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <>
                {messages.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-8 space-y-2">
                    <span className="text-3xl">💬</span>
                    <p className="text-sm text-zinc-500">Preguntame sobre tus gastos del mes</p>
                    <p className="text-xs text-zinc-400">Ej: ¿Dónde gasté más? ¿Cómo reduzco mis gastos en comida?</p>
                  </div>
                )}

                <div className="flex-1 space-y-3 overflow-y-auto">
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-brand-600 text-white rounded-br-sm'
                            : 'bg-zinc-100 text-zinc-800 rounded-bl-sm'
                        }`}
                      >
                        {msg.text || (streaming && i === messages.length - 1 ? <span className="inline-block w-2 h-3.5 bg-zinc-400 animate-pulse rounded-sm align-middle" /> : '')}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Input area */}
        <div className="px-4 py-3 border-t border-zinc-200 flex-shrink-0">
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
              {streaming ? (
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <span className="text-sm">↑</span>
              )}
            </button>
          </div>
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="mt-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              Limpiar conversación
            </button>
          )}
        </div>
    </div>
  )
}
