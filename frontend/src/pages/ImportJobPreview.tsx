import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getImportJob, confirmImportJob, deleteImportJob, updateImportPreview, getDistinctValues } from '../api/client'
import { useState } from 'react'
import type { SmartImportRow, ImportSummary } from '../types'

// Validation helpers (copied from ImportPage)
function validateRows(rows: SmartImportRow[]): { valid: boolean; missingCount: number } {
  const missing = rows.filter(r => !r.bank || !r.card || !r.person).length
  return { valid: missing === 0, missingCount: missing }
}

function applyBulkEdit(
  rows: SmartImportRow[],
  bank: string,
  card: string,
  person: string,
  onlyEmpty: boolean
): SmartImportRow[] {
  return rows.map(r => ({
    ...r,
    bank: onlyEmpty && r.bank ? r.bank : bank,
    card: onlyEmpty && r.card ? r.card : card,
    person: onlyEmpty && r.person ? r.person : person,
  }))
}

function deriveSummaryFromRows(rows: SmartImportRow[]): Partial<ImportSummary> {
  const nonDuplicateRows = rows.filter(r => !r.is_duplicate)

  if (nonDuplicateRows.length === 0) return {}

  // Get consensus value (most common)
  const getConsensus = (field: keyof SmartImportRow) => {
    const counts = new Map<string, number>()
    nonDuplicateRows.forEach(r => {
      const value = r[field] as string
      if (value && value.trim()) {
        counts.set(value, (counts.get(value) || 0) + 1)
      }
    })

    let maxCount = 0
    let consensus = ''
    counts.forEach((count, value) => {
      if (count > maxCount) {
        maxCount = count
        consensus = value
      }
    })

    return consensus
  }

  return {
    bank: getConsensus('bank'),
    card_type: getConsensus('card'),  // 'card' in rows maps to 'card_type' in summary
    person: getConsensus('person')
  }
}

export default function ImportJobPreview() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [editedRows, setEditedRows] = useState<SmartImportRow[]>([])
  const [editedSummary, setEditedSummary] = useState<ImportSummary | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDiscardModal, setShowDiscardModal] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showResultModal, setShowResultModal] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; scheduled: number; skipped: number } | null>(null)
  const [editForm, setEditForm] = useState({ bank: '', card: '', person: '', onlyEmpty: true })

  const { data: job, isLoading, error } = useQuery({
    queryKey: ['import-job', jobId],
    queryFn: () => getImportJob(Number(jobId)),
    enabled: !!jobId,
    retry: false
  })

  const { data: distinctValues } = useQuery({
    queryKey: ['distinct-values'],
    queryFn: getDistinctValues,
  })

  const confirmMutation = useMutation({
    mutationFn: (rows: SmartImportRow[]) => confirmImportJob(Number(jobId), rows),
    onSuccess: (result: { imported: number; scheduled: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setImportResult(result)
      setShowResultModal(true)
    }
  })

  const discardMutation = useMutation({
    mutationFn: () => deleteImportJob(Number(jobId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      navigate('/expenses')
    }
  })

  const updatePreviewMutation = useMutation({
    mutationFn: (previewData: any) => updateImportPreview(Number(jobId), previewData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-job', Number(jobId)] })
    }
  })

  // Validation
  const rows = editedRows.length > 0 ? editedRows : (job?.preview_data?.rows || [])
  const validation = validateRows(rows)
  const dataComplete = validation.valid

  // Compute current summary (use edited summary if available, otherwise job summary)
  const currentSummary = editedSummary || job?.preview_data?.summary

  const handleConfirm = () => {
    const finalValidation = validateRows(rows)

    if (!finalValidation.valid) {
      alert(`Faltan datos en ${finalValidation.missingCount} fila(s). Completalos antes de importar.`)
      return
    }

    confirmMutation.mutate(rows)
  }

  const handleDiscard = () => {
    setShowDiscardModal(true)
  }

  const confirmDiscard = () => {
    setShowDiscardModal(false)
    discardMutation.mutate()
  }

  const handleOpenEditModal = () => {
    const summary = job?.preview_data?.summary
    const firstRow = rows.find((r: SmartImportRow) => !r.is_duplicate)

    setEditForm({
      bank: summary?.bank || firstRow?.bank || '',
      card: summary?.card_type || firstRow?.card || '',
      person: summary?.person || firstRow?.person || '',
      onlyEmpty: true
    })

    setShowEditModal(true)
  }

  const handleApplyEdit = () => {
    if (!editForm.bank || !editForm.card || !editForm.person) {
      alert('Completá todos los campos')
      return
    }

    const currentRows = editedRows.length > 0 ? editedRows : (job?.preview_data?.rows || [])
    const updated = applyBulkEdit(
      currentRows,
      editForm.bank,
      editForm.card,
      editForm.person,
      editForm.onlyEmpty
    )

    setEditedRows(updated)

    // Update summary derived from edited rows
    const derivedSummary = deriveSummaryFromRows(updated)
    const newSummary = {
      ...currentSummary,
      ...derivedSummary
    } as ImportSummary
    setEditedSummary(newSummary)

    // Persist changes to backend
    updatePreviewMutation.mutate({
      rows: updated,
      summary: newSummary,
      raw_count: job?.preview_data?.raw_count || updated.length,
      has_missing_data: updated.some(r => !r.bank || !r.card || !r.person)
    })

    setShowEditModal(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-secondary)]">Cargando preview...</div>
      </div>
    )
  }

  // Handle 410 Gone (TTL expired)
  if ((error as any)?.response?.status === 410) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-6xl">⏰</div>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
            Importación expirada
          </h2>
          <p className="text-[var(--text-secondary)] text-sm mb-4">
            Este preview expiró después de 24 horas y fue eliminado automáticamente.
          </p>
          <button
            onClick={() => navigate('/expenses')}
            className="px-4 py-2 rounded-md bg-[var(--color-primary)] text-white text-sm font-medium hover:brightness-110 transition"
          >
            Volver a Gastos
          </button>
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-secondary)]">Import job no encontrado</div>
      </div>
    )
  }

  if (job.status === 'PROCESSING') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-[var(--text-secondary)]">
          Procesando {job.filename}... Recibirás una notificación cuando esté listo.
        </div>
        <button
          onClick={() => setShowCancelModal(true)}
          className="px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
        >
          Cancelar procesamiento
        </button>
      </div>
    )
  }

  if (job.status === 'FAILED') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">
          Error al procesar {job.filename}: {job.error_message}
        </div>
      </div>
    )
  }

  if (!job.preview_data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-secondary)]">No hay preview disponible</div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4 max-h-screen overflow-y-auto">
      {/* Header con botones */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Preview: {job.filename}
        </h1>
        <div className="flex gap-2">
          <button
            onClick={handleDiscard}
            disabled={discardMutation.isPending}
            className="btn-outline-danger"
          >
            {discardMutation.isPending ? 'Descartando...' : 'Descartar'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirmMutation.isPending || !dataComplete}
            className="px-4 py-2 rounded-md bg-[var(--color-primary)] text-[var(--color-on-primary)] text-sm font-medium hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            {confirmMutation.isPending
              ? 'Confirmando...'
              : dataComplete
                ? 'Confirmar importación'
                : 'Completar datos primero'}
          </button>
        </div>
      </div>

      {/* Warning si faltan datos */}
      {!dataComplete && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-start gap-3">
          <span className="text-yellow-600 text-xl">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-700">
              Datos incompletos
            </p>
            <p className="text-xs text-yellow-600 mt-1">
              Faltan datos en {validation.missingCount} transacción(es).
              Completá banco, tarjeta y persona antes de confirmar.
            </p>
            <button
              onClick={handleOpenEditModal}
              className="mt-2 text-xs px-3 py-1.5 rounded-md bg-yellow-500 hover:bg-yellow-600 text-white font-medium transition"
            >
              Completar datos
            </button>
          </div>
        </div>
      )}

      {/* Summary card */}
      {currentSummary && (
        <div className="bg-[var(--color-base-container)] rounded-lg p-4 border border-[var(--border-color)] space-y-2">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Resumen</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-[var(--text-secondary)]">Banco:</span>
              <span className="ml-2 text-[var(--text-primary)] font-medium">{currentSummary.bank || '-'}</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">Tarjeta:</span>
              <span className="ml-2 text-[var(--text-primary)] font-medium">{currentSummary.card_type || '-'}</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">Titular:</span>
              <span className="ml-2 text-[var(--text-primary)] font-medium">{currentSummary.person || '-'}</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">Cierre:</span>
              <span className="ml-2 text-[var(--text-primary)] font-medium">{currentSummary.closing_date || '-'}</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">Vencimiento:</span>
              <span className="ml-2 text-[var(--text-primary)] font-medium">{currentSummary.due_date || '-'}</span>
            </div>
            {currentSummary.total_ars !== null && (
              <div>
                <span className="text-[var(--text-secondary)]">Total ARS:</span>
                <span className="ml-2 text-[var(--text-primary)] font-medium">${currentSummary.total_ars.toFixed(2)}</span>
              </div>
            )}
            {currentSummary.total_usd !== null && (
              <div>
                <span className="text-[var(--text-secondary)]">Total USD:</span>
                <span className="ml-2 text-[var(--text-primary)] font-medium">${currentSummary.total_usd.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transactions table */}
      <div className="bg-[var(--color-base-container)] rounded-lg border border-[var(--border-color)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-base-alt)] border-b border-[var(--border-color)]">
              <tr className="text-left text-[var(--text-secondary)]">
                <th className="py-3 px-4">Fecha</th>
                <th className="py-3 px-4">Descripción</th>
                <th className="py-3 px-4">Monto</th>
                <th className="py-3 px-4">Tarjeta</th>
                <th className="py-3 px-4">Banco</th>
                <th className="py-3 px-4">Persona</th>
                <th className="py-3 px-4">Categoría</th>
                <th className="py-3 px-4">Cuotas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: SmartImportRow, idx: number) => (
                <tr
                  key={idx}
                  className={`border-b border-[var(--border-color)] hover:bg-[var(--color-base-alt)] transition ${
                    row.is_duplicate ? 'opacity-50 bg-yellow-500/10' : ''
                  } ${row.is_auto_generated ? 'bg-blue-500/5' : ''}`}
                >
                  <td className="py-2 px-4 whitespace-nowrap">{row.date}</td>
                  <td className="py-2 px-4">{row.description}</td>
                  <td className="py-2 px-4 whitespace-nowrap">
                    {row.amount} {row.currency}
                  </td>
                  <td className="py-2 px-4">{row.card || '-'}</td>
                  <td className="py-2 px-4">{row.bank || '-'}</td>
                  <td className="py-2 px-4">{row.person || '-'}</td>
                  <td className="py-2 px-4">{row.suggested_category || '-'}</td>
                  <td className="py-2 px-4 whitespace-nowrap">
                    {row.installment_number && row.installment_total
                      ? `${row.installment_number}/${row.installment_total}`
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stats */}
      <div className="text-xs text-[var(--text-secondary)] space-y-1">
        <p>Total de transacciones: {rows.length}</p>
        <p>Duplicadas: {rows.filter((r: SmartImportRow) => r.is_duplicate).length}</p>
        <p>Programadas (futuras): {rows.filter((r: SmartImportRow) => (r as any).is_scheduled).length}</p>
        <p>Generadas automáticamente: {rows.filter((r: SmartImportRow) => r.is_auto_generated).length}</p>
      </div>

      {/* Modal de bulk edit */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
              Completar datos faltantes
            </h3>

            {/* Banco */}
            <div className="space-y-1 mb-3">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Banco</label>
              <input
                type="text"
                value={editForm.bank}
                onChange={(e) => setEditForm(prev => ({ ...prev, bank: e.target.value }))}
                list="banks-list"
                className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="Ej: Galicia"
              />
              <datalist id="banks-list">
                {distinctValues?.banks.map(bank => (
                  <option key={bank} value={bank} />
                ))}
              </datalist>
            </div>

            {/* Tarjeta */}
            <div className="space-y-1 mb-3">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Tarjeta</label>
              <input
                type="text"
                value={editForm.card}
                onChange={(e) => setEditForm(prev => ({ ...prev, card: e.target.value }))}
                list="cards-list"
                className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="Ej: Visa Signature"
              />
              <datalist id="cards-list">
                {distinctValues?.cards.map(card => (
                  <option key={card} value={card} />
                ))}
              </datalist>
            </div>

            {/* Persona */}
            <div className="space-y-1 mb-3">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Titular</label>
              <input
                type="text"
                value={editForm.person}
                onChange={(e) => setEditForm(prev => ({ ...prev, person: e.target.value }))}
                list="persons-list"
                className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="Ej: Marcelo"
              />
              <datalist id="persons-list">
                {distinctValues?.persons.map(person => (
                  <option key={person} value={person} />
                ))}
              </datalist>
            </div>

            {/* Checkbox */}
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mb-4">
              <input
                type="checkbox"
                checked={editForm.onlyEmpty}
                onChange={(e) => setEditForm(prev => ({ ...prev, onlyEmpty: e.target.checked }))}
                className="rounded"
              />
              Aplicar solo a campos vacíos (recomendado)
            </label>

            {/* Botones */}
            <div className="flex gap-2">
              <button
                onClick={handleApplyEdit}
                disabled={!editForm.bank || !editForm.card || !editForm.person}
                className="flex-1 px-4 py-2 rounded-md bg-[var(--color-primary)] text-white font-medium hover:brightness-110 disabled:opacity-50 transition"
              >
                Aplicar
              </button>
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación de descarte */}
      {showDiscardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDiscardModal(false)}>
          <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <span className="text-3xl">⚠️</span>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                  ¿Descartar importación?
                </h3>
                <p className="text-sm text-[var(--text-secondary)]">
                  Se descartará el preview de <strong>{job?.filename}</strong>.
                  Esta acción no se puede deshacer.
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDiscardModal(false)}
                className="btn-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDiscard}
                disabled={discardMutation.isPending}
                className="btn-danger"
              >
                {discardMutation.isPending ? 'Descartando...' : 'Descartar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de cancelar procesamiento */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCancelModal(false)}>
          <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <span className="text-3xl">⚠️</span>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                  ¿Cancelar procesamiento?
                </h3>
                <p className="text-sm text-[var(--text-secondary)]">
                  Se cancelará el procesamiento de <strong>{job?.filename}</strong> y se descartará el archivo.
                  Esta acción no se puede deshacer.
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition-colors"
              >
                No, continuar
              </button>
              <button
                onClick={() => {
                  deleteMutation.mutate()
                  setShowCancelModal(false)
                }}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteMutation.isPending ? 'Cancelando...' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de resultado de importación */}
      {showResultModal && importResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => {
          setShowResultModal(false)
          navigate('/expenses')
        }}>
          <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <span className="text-3xl">✅</span>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                  Importación completada
                </h3>
                <div className="space-y-2 text-sm text-[var(--text-secondary)]">
                  <div className="flex justify-between">
                    <span>Gastos importados:</span>
                    <span className="font-semibold text-[var(--text-primary)]">{importResult.imported}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cuotas programadas:</span>
                    <span className="font-semibold text-[var(--text-primary)]">{importResult.scheduled}</span>
                  </div>
                  {importResult.skipped > 0 && (
                    <div className="flex justify-between">
                      <span>Duplicados omitidos:</span>
                      <span className="font-semibold text-yellow-600">{importResult.skipped}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowResultModal(false)
                  navigate('/expenses')
                }}
                className="px-4 py-2 rounded-md bg-[var(--color-primary)] text-[var(--color-on-primary)] text-sm font-medium hover:brightness-110 transition-colors"
              >
                Ver gastos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
