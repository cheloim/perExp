import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { importSmart, importRowsConfirm, getCards } from '../api/client'
import type { SmartImportRow, FileImportResult, Card } from '../types'

function formatCurrency(amount: number, currency: string = 'ARS') {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount)
  }
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount)
}

type Step = 'upload' | 'preview' | 'done'

function deduplicateInstallments(rows: SmartImportRow[]): SmartImportRow[] {
  const key = (r: SmartImportRow) => {
    if (!r.installment_number || !r.installment_total || r.installment_total < 2) return null
    const desc = r.description?.toLowerCase() ?? ''
    if (r.transaction_id) {
      return `txn:${r.transaction_id}|${r.installment_number}|${r.installment_total}`
    }
    const d = r.date ?? ''
    const month = /^\d{2}-\d{2}-\d{4}$/.test(d)
      ? `${d.slice(6)}-${d.slice(3, 5)}`
      : d.slice(0, 7)
    return `${desc}|${r.installment_number}|${r.installment_total}|${month}`
  }

  const seen = new Map<string, number>()
  const result: SmartImportRow[] = []

  for (const row of rows) {
    const k = key(row)
    if (k === null) {
      result.push(row)
      continue
    }
    if (seen.has(k)) {
      const existingIdx = seen.get(k)!
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

function applyBulkEdit(rows: SmartImportRow[], bank: string, card: string, person: string, onlyEmpty: boolean): SmartImportRow[] {
  return rows.map(r => ({
    ...r,
    bank: onlyEmpty && r.bank ? r.bank : bank,
    card: onlyEmpty && r.card ? r.card : card,
    person: onlyEmpty && r.person ? r.person : person,
  }))
}

function validateRows(rows: SmartImportRow[]): { valid: boolean; missingCount: number } {
  const missing = rows.filter(r => !r.bank || !r.card || !r.person).length
  return { valid: missing === 0, missingCount: missing }
}

function isFileDataComplete(rows: SmartImportRow[]): boolean {
  const nonDupes = rows.filter(r => !r.is_duplicate)
  if (nonDupes.length === 0) return false
  return nonDupes.every(r => r.bank && r.card && r.person)
}

function extractUniqueBanks(cards: Card[]): string[] {
  const banks = new Set(cards.map(c => c.bank).filter(Boolean))
  return Array.from(banks).sort()
}

function extractUniqueHolders(rows: SmartImportRow[]): string[] {
  const holders = new Set(rows.map(r => r.person).filter(Boolean))
  return Array.from(holders).sort()
}

export default function ImportPage() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep]               = useState<Step>('upload')
  const [fileResults, setFileResults] = useState<FileImportResult[]>([])
  const [result, setResult]           = useState<{ imported: number; skipped: number } | null>(null)
  const [errors, setErrors]           = useState<string[]>([])
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [queued, setQueued]           = useState(0)

  const [editModalFile, setEditModalFile] = useState<string | null>(null)
  const [editBank, setEditBank] = useState('')
  const [editCard, setEditCard] = useState('')
  const [editPerson, setEditPerson] = useState('')
  const [onlyEmpty, setOnlyEmpty] = useState(true)
  const [importingSingle, setImportingSingle] = useState<string | null>(null)

  const fileQueueRef  = useRef<File[]>([])
  const processingRef = useRef(false)
  const accErrsRef    = useRef<string[]>([])

  const isProcessing = currentFile !== null

  const { data: existingCards = [] } = useQuery({
    queryKey: ['cards'],
    queryFn: getCards,
  })

  const existingBanks = extractUniqueBanks(existingCards)
  const existingHolders = extractUniqueHolders(
    fileResults.flatMap(f => f.rows)
  )

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['expenses'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['installments'] })
    qc.invalidateQueries({ queryKey: ['installments-monthly-load'] })
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

  const processQueue = async () => {
    if (processingRef.current) return
    processingRef.current = true
    let hasResults = fileResults.length > 0

    while (fileQueueRef.current.length > 0) {
      const file = fileQueueRef.current.shift()!
      setCurrentFile(file.name)
      setQueued(fileQueueRef.current.length)
      try {
        const data = await smartMut.mutateAsync(file)
        const newResult: FileImportResult = {
          filename: file.name,
          rows: deduplicateInstallments(data.rows),
          raw_count: data.raw_count,
          summary: data.summary,
          has_missing_data: data.has_missing_data,
        }
        setFileResults(prev => [...prev, newResult])
        hasResults = true
      } catch (err: any) {
        accErrsRef.current.push(err?.response?.data?.detail ?? `Error al procesar ${file.name}`)
        setErrors([...accErrsRef.current])
      }
    }

    processingRef.current = false
    setCurrentFile(null)
    setQueued(0)
    if (hasResults || fileQueueRef.current.length === 0) {
      setStep('preview')
    }
  }

  const addFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    if (files.length === 0) return

    if (!processingRef.current && step !== 'preview') {
      accErrsRef.current = []
      setErrors([])
      setFileResults([])
    }

    if (step === 'done') setStep('upload')

    fileQueueRef.current.push(...files)
    setQueued(fileQueueRef.current.length)
    if (step !== 'preview') setStep('preview')
    processQueue()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }

  const handleOpenEditModal = (filename: string) => {
    const fileResult = fileResults.find(f => f.filename === filename)
    if (!fileResult) return
    
    setEditModalFile(filename)
    setEditBank(fileResult.summary.bank || '')
    setEditCard(fileResult.summary.card_type || '')
    setEditPerson(fileResult.rows[0]?.person || '')
    setOnlyEmpty(true)
  }

  const handleApplyEdit = () => {
    if (!editModalFile) return
    
    if (!editBank || !editCard || !editPerson) {
      alert('Todos los campos son obligatorios')
      return
    }

    setFileResults(prev => prev.map(f => {
      if (f.filename !== editModalFile) return f
      return {
        ...f,
        rows: applyBulkEdit(f.rows, editBank, editCard, editPerson, onlyEmpty),
        has_missing_data: false,
      }
    }))
    setEditModalFile(null)
  }

  const handleRemoveFile = (filename: string) => {
    setFileResults(prev => prev.filter(f => f.filename !== filename))
  }

  const handleImportSingle = async (fileResult: FileImportResult) => {
    const valid = validateRows(fileResult.rows)
    if (!valid.valid) {
      alert('Completá los datos faltantes primero')
      return
    }

    setImportingSingle(fileResult.filename)

    try {
      const data = await importRowsConfirm(fileResult.rows)
      const remainingFiles = fileResults.filter(f => f.filename !== fileResult.filename)

      if (remainingFiles.length === 0) {
        // Last file imported, show success screen
        setResult(data)
        setStep('done')
        invalidate()
      }

      setFileResults(remainingFiles)
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? 'Error al importar')
    } finally {
      setImportingSingle(null)
    }
  }

  const handleConfirmImport = () => {
    const allRows = fileResults.flatMap(f => f.rows)
    const validation = validateRows(allRows)
    if (!validation.valid) {
      alert(`Faltan datos en ${validation.missingCount} fila(s). Completalos antes de importar.`)
      return
    }
    confirmSmartMut.mutate(allRows)
  }

  const reset = () => {
    fileQueueRef.current = []
    processingRef.current = false
    setStep('upload')
    setFileResults([])
    setResult(null)
    setErrors([])
    setCurrentFile(null)
    setQueued(0)
    setEditModalFile(null)
    smartMut.reset()
    confirmSmartMut.reset()
    if (fileRef.current) fileRef.current.value = ''
  }

  const totalRows = fileResults.reduce((acc, f) => acc + f.rows.length, 0)
  const totalDupes = fileResults.reduce((acc, f) => acc + f.rows.filter(r => r.is_duplicate).length, 0)
  const totalAutoGen = fileResults.reduce((acc, f) => acc + f.rows.filter(r => r.is_auto_generated && !r.is_duplicate).length, 0)
  const missingDataFiles = fileResults.filter(f => f.has_missing_data).length

  if (step === 'done' && result) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-4">
        <div className="text-5xl">✅</div>
        <h2 className="text-xl font-semibold text-primary">Importación completada</h2>
        <p className="text-secondary">
          Se importaron <strong>{result.imported}</strong> gastos.
          {result.skipped > 0 && ` Se omitieron ${result.skipped} filas.`}
        </p>
        <button onClick={reset} className="mt-4 px-6 py-2 text-sm text-on-primary bg-primary rounded-lg hover:brightness-110">
          Importar otro archivo
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm">
        {(['upload', 'preview'] as Step[]).map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            {i > 0 && <span className="text-tertiary">›</span>}
            <span className={`font-medium ${step === s || (s === 'upload' && isProcessing) ? 'text-primary' : 'text-tertiary'}`}>
              {i + 1}. {s === 'upload' ? 'Cargar archivos' : 'Confirmar'}
            </span>
          </span>
        ))}
      </div>

      <p className="text-xs text-secondary">
        ✨ La IA detecta automáticamente las columnas. Soporta CSV, Excel y <strong>PDF</strong>. Podés agregar más archivos en cualquier momento.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xls,.xlsx,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            addFiles(e.target.files)
            e.target.value = ''
          }
        }}
      />

      {(step === 'upload' || (step === 'preview' && fileResults.length === 0)) && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-border-color rounded-2xl p-12 text-center hover:border-primary transition-colors cursor-pointer"
          onClick={() => fileRef.current?.click()}
        >
          {isProcessing ? (
            <div className="space-y-3">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
              <p className="text-primary font-medium text-sm truncate max-w-xs mx-auto">
                Analizando: <span className="text-primary">{currentFile}</span>
              </p>
              {queued > 0 && (
                <p className="text-tertiary text-xs">{queued} archivo{queued > 1 ? 's' : ''} más en cola</p>
              )}
              <p className="text-tertiary text-xs mt-1">Podés seguir agregando archivos mientras se procesan</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-4xl">✨</div>
              <p className="text-primary font-medium">Arrastrá o hacé click para cargar archivos</p>
              <p className="text-secondary text-sm">CSV, XLS, XLSX o PDF · múltiples archivos</p>
            </div>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <div className="alert-error">
          {errors.map((err, i) => (
            <p key={i} className="text-sm text-danger">{err}</p>
          ))}
        </div>
      )}

      {step === 'preview' && fileResults.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-primary bg-primary-subtle border border-border-color rounded-lg px-4 py-2">
            <span>✨</span>
            <span>La IA detectó <strong>{fileResults.reduce((a, f) => a + f.raw_count, 0)}</strong> transacciones en {fileResults.length} archivo{fileResults.length > 1 ? 's' : ''}.</span>
            {missingDataFiles > 0 && (
              <span className="ml-2 text-warning font-medium">
                ({missingDataFiles} archivo{missingDataFiles > 1 ? 's' : ''} sin datos de banco/tarjeta)
              </span>
            )}
          </div>

          {totalDupes > 0 && (
            <div className="flex items-center gap-2 text-sm text-warning bg-warning/5 border border-warning/20 rounded-lg px-4 py-2">
              <span>⚠️</span>
              <span>
                <strong>{totalDupes}</strong> fila{totalDupes > 1 ? 's' : ''} ya exist{totalDupes > 1 ? 'en' : 'e'} y {totalDupes > 1 ? 'serán omitidas' : 'será omitida'}.
              </span>
            </div>
          )}

          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="border border-dashed border-border-color rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:border-primary hover:bg-primary-subtle/40 transition-colors"
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary flex-shrink-0" />
                <span className="text-sm text-secondary truncate">
                  Analizando <span className="font-medium text-primary">{currentFile}</span>
                  {queued > 0 && <span className="text-tertiary"> · {queued} en cola</span>}
                </span>
              </>
            ) : (
              <>
                <span className="text-lg">➕</span>
                <span className="text-sm text-secondary">Agregar más archivos al preview</span>
              </>
            )}
          </div>

          {fileResults.map((fileResult, idx) => {
            const fileReady = isFileDataComplete(fileResult.rows)
            const nonDupeCount = fileResult.rows.filter(r => !r.is_duplicate).length
            const isImporting = importingSingle === fileResult.filename
            
            return (
            <div key={idx} className="card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-color bg-base-alt">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRemoveFile(fileResult.filename)}
                    className="text-tertiary hover:text-danger text-sm p-1 rounded hover:bg-danger/10 transition"
                    title="Eliminar archivo"
                  >
                    ✕
                  </button>
                  <span className="text-lg">📄</span>
                  <h3 className="font-semibold text-primary">{fileResult.filename}</h3>
                  {fileResult.has_missing_data && (
                    <span className="badge-warning">
                      ⚠️ Datos incompletos
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-tertiary">
                    {nonDupeCount} filas
                    {fileResult.rows.filter(r => r.is_duplicate).length > 0 && (
                      <span className="text-warning"> · {fileResult.rows.filter(r => r.is_duplicate).length} dup</span>
                    )}
                  </span>
                  {fileResult.has_missing_data ? (
                    <button
                      onClick={() => handleOpenEditModal(fileResult.filename)}
                      className="px-3 py-1 text-xs font-medium bg-warning text-white rounded-md hover:brightness-110 transition"
                    >
                      Completar datos
                    </button>
                  ) : (
                    <button
                      onClick={() => handleImportSingle(fileResult)}
                      disabled={isImporting || !fileReady}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                        fileReady 
                          ? 'bg-success text-white hover:brightness-110' 
                          : 'bg-tertiary/30 text-tertiary cursor-not-allowed'
                      }`}
                    >
                      {isImporting ? 'Importando...' : `Importar ${nonDupeCount}`}
                    </button>
                  )}
                </div>
              </div>

              {fileResult.summary.bank && (
                <div className="px-5 py-2 text-xs text-secondary border-b border-border-color bg-primary-subtle/30">
                  <span className="font-medium">{fileResult.summary.card_type}</span>
                  {fileResult.summary.bank && <span> · {fileResult.summary.bank}</span>}
                  {fileResult.summary.due_date && <span> · Vence: {fileResult.summary.due_date}</span>}
                </div>
              )}

              <div className="overflow-x-auto max-h-60">
                <table className="w-full text-sm">
                  <thead className="bg-base-alt text-secondary text-xs uppercase tracking-wider sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left">Fecha</th>
                      <th className="px-4 py-2 text-left">Descripción</th>
                      <th className="px-4 py-2 text-right">Monto</th>
                      <th className="px-4 py-2 text-left">Banco</th>
                      <th className="px-4 py-2 text-left">Tarjeta</th>
                      <th className="px-4 py-2 text-left">Titular</th>
                      <th className="px-4 py-2 text-left">Moneda</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-color">
                    {fileResult.rows.slice(0, 10).map((row, i) => (
                      <tr
                        key={i}
                        className={
                          row.is_duplicate
                            ? 'bg-warning/10 opacity-60'
                            : row.is_auto_generated
                            ? 'bg-primary-subtle hover:bg-primary-subtle'
                            : 'hover:bg-base-alt'
                        }
                      >
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">
                          {row.date}
                          {row.is_duplicate && <span className="ml-1 text-warning text-xs">dup</span>}
                        </td>
                        <td className="px-4 py-2 text-primary max-w-[180px] truncate" title={row.description}>
                          {row.description}
                        </td>
                        <td className={`px-4 py-2 text-right font-medium ${row.amount < 0 ? 'text-success' : ''}`}>
                          {formatCurrency(row.amount, row.currency)}
                        </td>
                        <td className="px-4 py-2 text-secondary">{row.bank || <span className="text-tertiary">—</span>}</td>
                        <td className="px-4 py-2 text-secondary">{row.card || <span className="text-tertiary">—</span>}</td>
                        <td className="px-4 py-2 text-primary font-medium">{row.person || <span className="text-tertiary">—</span>}</td>
                        <td className="px-4 py-2">
                          {row.currency === 'USD'
                            ? <span className="badge-success">USD</span>
                            : <span className="text-xs text-tertiary">ARS</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {fileResult.rows.length > 10 && (
                <p className="text-xs text-tertiary px-5 py-2 border-t border-border-color">
                  Mostrando 10 de {fileResult.rows.length} filas
                </p>
              )}
            </div>
            )
          })}

          <div className="flex justify-between items-center pt-4 border-t border-border-color">
            <button onClick={reset} className="btn-secondary">← Volver</button>
            <div className="text-right">
              <p className="text-xs text-tertiary mb-2">
                {totalRows - totalDupes} gastos a importar
                {totalAutoGen > 0 && ` (${totalAutoGen} cuotas auto-generadas)`}
              </p>
              <button
                onClick={handleConfirmImport}
                disabled={confirmSmartMut.isPending || isProcessing || missingDataFiles > 0}
                className="btn-primary bg-success hover:brightness-110 disabled:opacity-50 disabled:bg-tertiary"
              >
                {confirmSmartMut.isPending
                  ? 'Importando...'
                  : isProcessing
                  ? 'Esperando archivos...'
                  : missingDataFiles > 0
                  ? `Completar datos primero (${missingDataFiles} archivo${missingDataFiles > 1 ? 's' : ''})`
                  : `Importar ${totalRows - totalDupes} gastos`}
              </button>
            </div>
          </div>
        </div>
      )}

      {editModalFile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditModalFile(null)}>
          <div className="bg-[var(--color-base-container)] rounded-xl p-6 w-full max-w-md shadow-xl border border-border-color" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-primary">
                Completar datos faltantes
              </h2>
              <button onClick={() => setEditModalFile(null)} className="text-tertiary hover:text-primary text-xl">×</button>
            </div>
            
            <p className="text-sm text-secondary mb-4">
              Archivo: <span className="font-medium text-primary">{editModalFile}</span>
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-secondary block mb-1">🏦 Banco</label>
                <input
                  list="bank-options"
                  value={editBank}
                  onChange={e => setEditBank(e.target.value)}
                  placeholder="Ej: Galicia"
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <datalist id="bank-options">
                  {existingBanks.map(b => <option key={b} value={b} />)}
                </datalist>
              </div>

              <div>
                <label className="text-xs font-medium text-secondary block mb-1">💳 Tarjeta</label>
                <input
                  list="card-options"
                  value={editCard}
                  onChange={e => setEditCard(e.target.value)}
                  placeholder="Ej: Visa"
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <datalist id="card-options">
                  {existingCards
                    .filter(c => !editBank || c.bank.toLowerCase().includes(editBank.toLowerCase()))
                    .map(c => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>

              <div>
                <label className="text-xs font-medium text-secondary block mb-1">👤 Titular</label>
                <input
                  list="holder-options"
                  value={editPerson}
                  onChange={e => setEditPerson(e.target.value)}
                  placeholder="Ej: Natalia"
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <datalist id="holder-options">
                  {existingHolders.map(h => <option key={h} value={h} />)}
                </datalist>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="only-empty"
                  checked={onlyEmpty}
                  onChange={e => setOnlyEmpty(e.target.checked)}
                  className="w-4 h-4 rounded border-border-color text-primary focus:ring-primary/30"
                />
                <label htmlFor="only-empty" className="text-sm text-secondary">
                  Aplicar solo a campos vacíos (recomendado)
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border-color">
              <button onClick={() => setEditModalFile(null)} className="btn-secondary">
                Cancelar
              </button>
              <button onClick={handleApplyEdit} className="btn-primary">
                ✓ Aplicar datos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}