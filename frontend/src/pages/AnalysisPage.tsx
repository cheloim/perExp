import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAnalysisHistory, deleteAnalysisHistory } from '../api/client'
import type { AnalysisHistory } from '../types'

const SAVED_QUERIES_KEY = 'analysis_saved_queries'
const MAX_SAVED = 20

function loadSavedQueries(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_QUERIES_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveQuery(question: string) {
  if (!question.trim()) return
  const existing = loadSavedQueries().filter((q) => q !== question)
  const updated = [question, ...existing].slice(0, MAX_SAVED)
  localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(updated))
}

function removeQuery(question: string) {
  const updated = loadSavedQueries().filter((q) => q !== question)
  localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(updated))
}

function formatARS(amount: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(amount)
}

function formatDate(iso: string) {
  if (!iso) return ''
  if (iso.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [y, m, d] = iso.split('-')
    return `${d}-${m}-${y}`
  }
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function HistorySection() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<number | null>(null)

  const { data: history = [] } = useQuery({
    queryKey: ['analysis-history'],
    queryFn: getAnalysisHistory,
  })

  const deleteMut = useMutation({
    mutationFn: deleteAnalysisHistory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analysis-history'] }),
  })

  if (history.length === 0) return null

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
        Historial de análisis
      </h3>
      {history.map((h: AnalysisHistory) => (
        <div
          key={h.id}
          className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden"
        >
          <div
            className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-zinc-100 select-none"
            onClick={() => setExpanded(expanded === h.id ? null : h.id)}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs text-zinc-500 whitespace-nowrap">
                {formatDate(h.created_at)}
              </span>
              {h.month && (
                <span className="text-xs bg-brand-500/10 text-brand-400 px-2 py-0.5 rounded-full whitespace-nowrap">
                  {h.month}
                </span>
              )}
              <span className="text-sm text-zinc-400 truncate">
                {h.question || `${h.expense_count} gastos · ${formatARS(h.total_amount)}`}
              </span>
            </div>
            <div className="flex items-center gap-3 ml-3 flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm('¿Eliminar este análisis del historial?')) {
                    deleteMut.mutate(h.id)
                  }
                }}
                className="text-zinc-600 hover:text-red-400 text-base leading-none"
              >
                ✕
              </button>
              <span className="text-zinc-500 text-xs">{expanded === h.id ? '▲' : '▼'}</span>
            </div>
          </div>
          {expanded === h.id && (
            <div className="px-4 py-4 border-t border-zinc-200 bg-zinc-100 text-sm text-zinc-600 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
              {h.result_text}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function AnalysisPage() {
  const qc = useQueryClient()
  const [month, setMonth] = useState('')
  const [question, setQuestion] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [savedQueries, setSavedQueries] = useState<string[]>(loadSavedQueries)
  const outputRef = useRef<HTMLDivElement>(null)

  const refreshSaved = useCallback(() => setSavedQueries(loadSavedQueries()), [])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  const handleAnalyze = async () => {
    setOutput('')
    setError('')
    setStreaming(true)

    try {
      const response = await fetch('/api/analysis/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: month || null,
          question: question || null,
        }),
      })

      if (!response.ok) {
        throw new Error(`Error ${response.status}`)
      }

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
            if (raw === '[DONE]') {
              setStreaming(false)
              qc.invalidateQueries({ queryKey: ['analysis-history'] })
              if (question.trim()) {
                saveQuery(question.trim())
                refreshSaved()
              }
              return
            }
            try {
              const { text } = JSON.parse(raw) as { text: string }
              if (text) setOutput((prev) => prev + text)
            } catch {
              // skip malformed
            }
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-zinc-900">📈 Análisis de consumo</h2>
        <p className="text-sm text-zinc-400">
          Gemini analizará tus gastos y te dará sugerencias personalizadas de ahorro.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">
              Mes a analizar
            </label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full input"
            />
            <p className="text-xs text-zinc-500 mt-1">
              Dejá vacío para analizar todos los gastos
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">
              Pregunta específica (opcional)
            </label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ej: ¿Dónde gasto más en entretenimiento?"
              className="w-full input"
            />
          </div>
        </div>

        {savedQueries.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-400 font-medium">Consultas guardadas</p>
            <div className="flex flex-wrap gap-2">
              {savedQueries.map((q) => (
                <span
                  key={q}
                  className="group flex items-center gap-1 bg-zinc-100 hover:bg-brand-500/10 border border-zinc-200 hover:border-brand-500/30 rounded-full px-3 py-1 text-xs text-zinc-600 cursor-pointer transition-colors"
                  onClick={() => setQuestion(q)}
                >
                  <span className="truncate max-w-[260px]">{q}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeQuery(q)
                      refreshSaved()
                    }}
                    className="ml-1 text-zinc-500 hover:text-red-400 leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={handleAnalyze}
          disabled={streaming}
          className="w-full py-2.5 text-sm font-medium text-white bg-gradient-to-r from-brand-500 to-brand-700 rounded-lg hover:from-brand-600 hover:to-brand-800 disabled:opacity-50 transition"
        >
          {streaming ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              Analizando...
            </span>
          ) : (
            '✨ Analizar mis gastos'
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {(output || streaming) && (
        <div className="card">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-zinc-200">
            <span className="text-sm font-medium text-zinc-600">Análisis</span>
            {streaming && (
              <span className="flex items-center gap-1 text-xs text-blue-500">
                <span className="animate-pulse">●</span> Generando...
              </span>
            )}
          </div>
          <div
            ref={outputRef}
            className="px-5 py-4 text-sm text-zinc-600 whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto"
          >
            {output}
            {streaming && (
              <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        </div>
      )}

      <HistorySection />
    </div>
  )
}
