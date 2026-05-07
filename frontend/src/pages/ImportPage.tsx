import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { importSmart, importRowsConfirm } from '../api/client'
import type { SmartImportRow, ImportSummary } from '../types'

function formatCurrency(amount: number, currency: string = 'ARS') {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount)
  }
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount)
}

type Step = 'upload' | 'preview' | 'done'

// Deduplicates accumulated rows from multiple PDF imports.
// When a comprobante is present, uses (txn_id, inst_num, inst_total) as the unique key —
// Argentine statements share the same transaction_id across all installments of a purchase.
// Keeps the non-auto-generated (real) row when both versions exist for the same slot.
function deduplicateInstallments(rows: SmartImportRow[]): SmartImportRow[] {
  const key = (r: SmartImportRow) => {
    if (!r.installment_number || !r.installment_total || r.installment_total < 2) return null
    const desc = r.description?.toLowerCase() ?? ''
    if (r.transaction_id) {
      return `txn:${r.transaction_id}|${r.installment_number}|${r.installment_total}`
    }
    // No comprobante: fall back to description + slot + billing month.
    // Dates arrive as DD-MM-YYYY from the backend; parse year-month accordingly.
    const d = r.date ?? ''
    const month = /^\d{2}-\d{2}-\d{4}$/.test(d)
      ? `${d.slice(6)}-${d.slice(3, 5)}`   // YYYY-MM from DD-MM-YYYY
      : d.slice(0, 7)                        // YYYY-MM from YYYY-MM-DD
    return `${desc}|${r.installment_number}|${r.installment_total}|${month}`
  }

  const seen = new Map<string, number>() // key → index in result
  const result: SmartImportRow[] = []

  for (const row of rows) {
    const k = key(row)
    if (k === null) {
      result.push(row)
      continue
    }
    if (seen.has(k)) {
      const existingIdx = seen.get(k)!
      // Prefer the non-auto-generated (real) row
      if (result[existingIdx].is_auto_generated && !row.is_auto_generated) {
        result[existingIdx] = row
      }
    } else {
      seen.set(k, result.length)
      result.push(row)
    }
  }

  return result
}

export default function ImportPage() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep]               = useState<Step>('upload')
  const [smartRows, setSmartRows]     = useState<SmartImportRow[]>([])
  const [smartRawCount, setSmartRawCount] = useState(0)
  const [result, setResult]           = useState<{ imported: number; skipped: number } | null>(null)
  const [errors, setErrors]           = useState<string[]>([])
  const [currentFile, setCurrentFile] = useState<string | null>(null)  // file being processed right now
  const [queued, setQueued]           = useState(0)                    // files waiting in queue

  // Mutable refs — shared between renders without causing re-renders
  const fileQueueRef  = useRef<File[]>([])
  const processingRef = useRef(false)
  const accRowsRef    = useRef<SmartImportRow[]>([])
  const accRawRef     = useRef(0)
  const accErrsRef    = useRef<string[]>([])
  const accSummaries  = useRef<ImportSummary[]>([])

  const [summaries, setSummaries] = useState<ImportSummary[]>([])

  const isProcessing = currentFile !== null

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['expenses'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['installments'] })
    qc.invalidateQueries({ queryKey: ['card-summary'] })
  }

  const smartMut = useMutation({ mutationFn: (f: File) => importSmart(f) })

  const confirmSmartMut = useMutation({
    mutationFn: (rows: SmartImportRow[]) => importRowsConfirm(rows),
    onSuccess: (data) => {
      setResult(data)
      setStep('done')
      invalidate()
    },
  })

  // Drains the file queue one by one; safe to call multiple times (semaphore via processingRef).
  const processQueue = async () => {
    if (processingRef.current) return
    processingRef.current = true

    while (fileQueueRef.current.length > 0) {
      const file = fileQueueRef.current.shift()!
      setCurrentFile(file.name)
      setQueued(fileQueueRef.current.length)
      try {
        const data = await smartMut.mutateAsync(file)
        accRowsRef.current.push(...data.rows)
        accRawRef.current += data.raw_count
        if (data.summary) accSummaries.current.push(data.summary)
      } catch (err: any) {
        accErrsRef.current.push(err?.response?.data?.detail ?? `Error al procesar ${file.name}`)
      }
    }

    processingRef.current = false
    setCurrentFile(null)
    setQueued(0)
    setErrors([...accErrsRef.current])
    setSmartRows(deduplicateInstallments(accRowsRef.current))
    setSmartRawCount(accRawRef.current)
    setSummaries([...accSummaries.current])
    if (accRowsRef.current.length > 0) setStep('preview')
  }

  // Entry point for all file additions (drag, click, or "add more" button).
  const addFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    if (files.length === 0) return

    // Reset accumulators when starting fresh (not mid-processing and not already in preview)
    if (!processingRef.current && step !== 'preview') {
      accRowsRef.current   = []
      accRawRef.current    = 0
      accErrsRef.current   = []
      accSummaries.current = []
      setSmartRows([])
      setSmartRawCount(0)
      setErrors([])
      setSummaries([])
    }

    if (step === 'done') setStep('upload')

    fileQueueRef.current.push(...files)
    setQueued(fileQueueRef.current.length)
    processQueue()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }

  const handleConfirmImport = () => {
    confirmSmartMut.mutate(smartRows)
  }

  const reset = () => {
    fileQueueRef.current  = []
    processingRef.current = false
    accRowsRef.current    = []
    accRawRef.current     = 0
    accErrsRef.current    = []
    setStep('upload')
    setSmartRows([])
    setSmartRawCount(0)
    setResult(null)
    setErrors([])
    setCurrentFile(null)
    setQueued(0)
    smartMut.reset()
    confirmSmartMut.reset()
    if (fileRef.current) fileRef.current.value = ''
  }

  const previewCount  = smartRows.length
  const dupeCount     = smartRows.filter((r) => r.is_duplicate).length
  const autoGenCount  = smartRows.filter((r) => r.is_auto_generated && !r.is_duplicate).length

  if (step === 'done' && result) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-4">
        <div className="text-5xl">✅</div>
        <h2 className="text-xl font-semibold text-gray-800">Importación completada</h2>
        <p className="text-gray-600">
          Se importaron <strong>{result.imported}</strong> gastos.
          {result.skipped > 0 && ` Se omitieron ${result.skipped} filas.`}
        </p>
        <button onClick={reset} className="mt-4 px-6 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          Importar otro archivo
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Steps indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(['upload', 'preview'] as Step[]).map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            {i > 0 && <span className="text-gray-300">›</span>}
            <span className={`font-medium ${step === s || (s === 'upload' && isProcessing) ? 'text-blue-600' : 'text-gray-400'}`}>
              {i + 1}. {s === 'upload' ? 'Cargar archivos' : 'Confirmar'}
            </span>
          </span>
        ))}
      </div>

      <p className="text-xs text-gray-500">
        ✨ La IA detecta automáticamente las columnas. Soporta CSV, Excel y <strong>PDF</strong>. Podés agregar más archivos en cualquier momento, incluso mientras se procesan otros.
      </p>

      {/* Hidden file input — always mounted */}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xls,.xlsx,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            addFiles(e.target.files)
            // Reset the input so the same file can be re-added if needed
            e.target.value = ''
          }
        }}
      />

      {/* Dropzone — always visible and active */}
      {step !== 'preview' && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center hover:border-blue-400 transition-colors cursor-pointer"
          onClick={() => fileRef.current?.click()}
        >
          {isProcessing ? (
            <div className="space-y-3">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mx-auto" />
              <p className="text-gray-700 font-medium text-sm truncate max-w-xs mx-auto">
                Analizando: <span className="text-blue-600">{currentFile}</span>
              </p>
              {queued > 0 && (
                <p className="text-gray-400 text-xs">{queued} archivo{queued > 1 ? 's' : ''} más en cola</p>
              )}
              <p className="text-gray-400 text-xs mt-1">Podés seguir agregando archivos mientras se procesan</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-4xl">✨</div>
              <p className="text-gray-700 font-medium">Arrastrá o hacé click para cargar archivos</p>
              <p className="text-gray-400 text-sm">CSV, XLS, XLSX o PDF · múltiples archivos</p>
            </div>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-1">
          {errors.map((err, i) => (
            <p key={i} className="text-sm text-red-700">{err}</p>
          ))}
        </div>
      )}

      {/* Step: preview */}
      {step === 'preview' && smartRows.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2">
            <span>✨</span>
            <span>La IA detectó <strong>{smartRawCount}</strong> transacciones en los archivos.</span>
          </div>

          {/* Per-file summary cards */}
          {summaries.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {summaries.map((s, i) => (
                <div key={i} className="card p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono bg-zinc-200 text-zinc-700 px-2 py-0.5 rounded">
                      {s.card_last4 ? `•••• ${s.card_last4}` : '💳'}
                    </span>
                    <span className="text-sm font-semibold text-zinc-900">{s.card_type || '—'}</span>
                    {s.bank && <span className="text-xs text-zinc-400">{s.bank}</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-zinc-500">Consumos ARS</p>
                      <p className="text-zinc-900 font-semibold">
                        {s.total_ars != null ? formatCurrency(s.total_ars) : '—'}
                      </p>
                    </div>
                    {s.total_usd != null && (
                      <div>
                        <p className="text-zinc-500">Consumos USD</p>
                        <p className="text-zinc-900 font-semibold">{formatCurrency(s.total_usd, 'USD')}</p>
                      </div>
                    )}
                    {s.future_charges_ars != null && (
                      <div>
                        <p className="text-zinc-500">Consumos futuros ARS</p>
                        <p className="text-amber-400 font-semibold">{formatCurrency(s.future_charges_ars)}</p>
                      </div>
                    )}
                    {s.future_charges_usd != null && (
                      <div>
                        <p className="text-zinc-500">Consumos futuros USD</p>
                        <p className="text-amber-400 font-semibold">{formatCurrency(s.future_charges_usd, 'USD')}</p>
                      </div>
                    )}
                    {s.due_date && (
                      <div>
                        <p className="text-zinc-500">Vencimiento</p>
                        <p className="text-zinc-900 font-semibold">{s.due_date}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {dupeCount > 0 && (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
              <span>⚠️</span>
              <span>
                <strong>{dupeCount}</strong> fila{dupeCount > 1 ? 's' : ''} ya exist{dupeCount > 1 ? 'en' : 'e'} y {dupeCount > 1 ? 'serán omitidas' : 'será omitida'}.
              </span>
            </div>
          )}

          {/* Add more files while in preview */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="border border-dashed border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 flex-shrink-0" />
                <span className="text-sm text-gray-600 truncate">
                  Analizando <span className="font-medium text-blue-600">{currentFile}</span>
                  {queued > 0 && <span className="text-gray-400"> · {queued} en cola</span>}
                </span>
              </>
            ) : (
              <>
                <span className="text-lg">➕</span>
                <span className="text-sm text-gray-500">Agregar más archivos al preview</span>
              </>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-semibold text-gray-800">
                Preview — {previewCount} filas
                {dupeCount > 0 && <span className="ml-2 text-xs font-normal text-amber-600">({dupeCount} duplicadas)</span>}
                {autoGenCount > 0 && <span className="ml-2 text-xs font-normal text-indigo-600">({autoGenCount} cuotas prev. auto-generadas)</span>}
              </h2>
            </div>
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left">Fecha</th>
                    <th className="px-4 py-3 text-left">Descripción</th>
                    <th className="px-4 py-3 text-right">Monto</th>
                    <th className="px-4 py-3 text-left">Categoría</th>
                    <th className="px-4 py-3 text-left">Moneda</th>
                    <th className="px-4 py-3 text-left">Comprobante</th>
                    <th className="px-4 py-3 text-left">Banco</th>
                    <th className="px-4 py-3 text-left">Tarjeta</th>
                    <th className="px-4 py-3 text-left">Últimos 4</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {smartRows.slice(0, 50).map((row, i) => (
                    <tr
                      key={i}
                      className={
                        row.is_duplicate
                          ? 'bg-amber-50 opacity-60'
                          : row.is_auto_generated
                          ? 'bg-indigo-50/60 hover:bg-indigo-50'
                          : 'hover:bg-gray-50'
                      }
                    >
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                        {row.date}
                        {row.is_duplicate && <span className="ml-1 text-amber-500 text-xs">dup</span>}
                        {row.is_auto_generated && !row.is_duplicate && (
                          <span className="ml-1 text-indigo-500 text-xs">prev</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-800">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          {row.description}
                          {row.installment_number && row.installment_total && (
                            <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded whitespace-nowrap">
                              {row.installment_number}/{row.installment_total}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={`px-4 py-2 text-right font-medium ${row.amount < 0 ? 'text-green-600' : ''}`}>
                        {formatCurrency(row.amount, row.currency)}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{row.suggested_category ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-2">
                        {row.currency === 'USD'
                          ? <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">USD</span>
                          : <span className="text-xs text-gray-400">ARS</span>}
                      </td>
                      <td className="px-4 py-2 text-gray-400 font-mono text-xs">{row.transaction_id || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{row.bank || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{row.card || '—'}</td>
                      <td className="px-4 py-2 text-gray-500 font-mono text-xs">{row.card_last4 || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewCount > 50 && (
              <p className="text-xs text-gray-400 px-5 py-2 border-t">Mostrando 50 de {previewCount} filas</p>
            )}
          </div>

          <div className="flex justify-between">
            <button onClick={reset} className="btn-secondary">← Volver</button>
            <button
              onClick={handleConfirmImport}
              disabled={confirmSmartMut.isPending || isProcessing}
              className="btn-primary bg-green-600 hover:bg-green-700 disabled:opacity-50"
            >
              {confirmSmartMut.isPending
                ? 'Importando...'
                : isProcessing
                ? 'Esperando archivos...'
                : `Importar ${previewCount - dupeCount} gastos`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
