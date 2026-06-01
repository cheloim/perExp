import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getImportJob, confirmImportJob, deleteImportJob, updateImportPreview, getDistinctValues, getCards } from '../api/client'
import { useState, useEffect } from 'react'
import type { SmartImportRow, ImportSummary, DetectedCard, CardsMapping, Card } from '../types'
import { toUpperCase, titleCase } from '../utils/format'
import { useModalWithData } from '../hooks/useModal'
import { TransactionDetailModal } from '../components/TransactionDetailModal'

// Helper functions (copied from ImportPage)
function getCardKey(bank: string, card: string, holder: string): string {
  return `${bank}|${card}|${titleCase(holder)}`
}

function getSuggestionsForHolder(cards: Card[], holder: string): string[] {
  if (!holder) return []
  return cards
    .filter(c => c.holder?.toLowerCase() === holder.toLowerCase())
    .map(c => c.custom_naming)
    .filter(Boolean) as string[]
}

type CardNamingEdit = { custom_naming?: string; bank?: string; card_name?: string; holder?: string }

function generateCardsMapping(detectedCards: DetectedCard[], edits: Record<string, CardNamingEdit>): CardsMapping {
  const mapping: CardsMapping = {}
  for (const dc of detectedCards) {
    if (dc.card_type) {
      mapping[`_card_type_${dc.bank}_${dc.card}`] = { custom_naming: dc.card_type }
    }
    for (const holder of dc.holders) {
      const key = getCardKey(dc.bank, dc.card, holder)
      const entry = edits[key] || { custom_naming: dc.suggested_custom_naming, bank: dc.bank, card_name: dc.card }
      const customName = entry.custom_naming || dc.suggested_custom_naming
      mapping[key] = {
        custom_naming: customName,
        bank: entry.bank || dc.bank,
        card_name: entry.card_name || dc.card,
      }
    }
  }
  return mapping
}

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

  const [spotlightNaming, setSpotlightNaming] = useState(false)
  const [customNamingEdits, setCustomNamingEdits] = useState<Record<string, { custom_naming?: string; bank?: string; card_name?: string; holder?: string }>>({})
  const { data: selectedRow, openWithData: openRowDetail, close: closeRowDetail, isOpen: isRowDetailOpen } = useModalWithData<SmartImportRow>()

  // Persist custom naming edits to localStorage
  useEffect(() => {
    if (!jobId) return
    try {
      const stored = localStorage.getItem(`import_job_${jobId}_custom_naming`)
      const storedEdits = stored ? JSON.parse(stored) : {}
      if (Object.keys(storedEdits).length > 0) {
        setCustomNamingEdits(storedEdits)
      }
    } catch {
      // ignore
    }
  }, [jobId])

  useEffect(() => {
    if (!jobId || Object.keys(customNamingEdits).length === 0) return
    try {
      localStorage.setItem(`import_job_${jobId}_custom_naming`, JSON.stringify(customNamingEdits))
    } catch {
      // ignore
    }
  }, [customNamingEdits, jobId])

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

  const { data: cards = [] } = useQuery({
    queryKey: ['cards'],
    queryFn: getCards,
  })


  const confirmMutation = useMutation({
    mutationFn: ({ rows, cardsMapping }: { rows: SmartImportRow[], cardsMapping?: CardsMapping }) =>
      confirmImportJob(Number(jobId), rows, cardsMapping),
    onSuccess: (result: { imported: number; scheduled: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      setImportResult(result)
      setShowResultModal(true)
      // Clean up localStorage after successful import
      try {
        localStorage.removeItem(`import_job_${jobId}_custom_naming`)
        localStorage.removeItem(`import_job_${jobId}_custom_naming_saved`)
      } catch {
        // ignore
      }
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

  const deleteMutation = useMutation({
    mutationFn: () => deleteImportJob(Number(jobId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      navigate('/expenses')
    }
  })

  // Validation
  const rows = editedRows.length > 0 ? editedRows : (job?.preview_data?.rows || [])
  const validation = validateRows(rows)
  const dataComplete = validation.valid

  // Detected cards from job preview
  const detectedCards: DetectedCard[] = job?.preview_data?.detected_cards || []

  // Cards mapping derived from custom naming edits
  const cardsMapping: CardsMapping = generateCardsMapping(detectedCards, customNamingEdits)

  // Compute current summary (use edited summary if available, otherwise job summary)
  const currentSummary = editedSummary || job?.preview_data?.summary

  // Check if custom naming is complete
  const customNamingRequired = detectedCards.length > 0
  const customNamingComplete = customNamingRequired && detectedCards.every(dc => {
    const key = getCardKey(dc.bank, dc.card, dc.holders[0] || '')
    return customNamingEdits[key]?.custom_naming?.trim()
  })
  const canImport = dataComplete && (!customNamingRequired || customNamingComplete)

  const handleConfirm = () => {
    const finalValidation = validateRows(rows)

    if (!finalValidation.valid) {
      alert(`Faltan datos en ${finalValidation.missingCount} fila(s). Completalos antes de importar.`)
      return
    }

    if (customNamingRequired && !customNamingComplete) {
      alert('Tenés que completar los nombres de las tarjetas antes de importar.')
      return
    }

    confirmMutation.mutate({ rows, cardsMapping: customNamingComplete ? cardsMapping : undefined })
  }

  const handleSpotlightNaming = () => {
    if (customNamingComplete) return
    setSpotlightNaming(true)
    setTimeout(() => setSpotlightNaming(false), 3000)
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
            className="gnome-btn-primary"
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
    <div className="h-screen flex flex-col overflow-hidden p-2.5 gap-3">
      {/* Header con botones */}
      <div className="flex-shrink-0 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Preview: {job.filename}
        </h1>
        <div className="flex gap-2">
          <button
            onClick={handleDiscard}
            disabled={discardMutation.isPending}
            className="gnome-btn-outline-danger"
          >
            {discardMutation.isPending ? 'Descartando...' : 'Descartar'}
          </button>
          <button
            onClick={() => customNamingRequired && !customNamingComplete ? handleSpotlightNaming() : handleConfirm()}
            disabled={confirmMutation.isPending || !canImport}
            className="gnome-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirmMutation.isPending
              ? 'Confirmando...'
              : canImport
                ? 'Confirmar importación'
                : !dataComplete
                  ? 'Completar datos'
                  : 'Completar nombres de tarjetas'}
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
              className="gnome-btn-warning"
            >
              Completar datos
            </button>
          </div>
        </div>
      )}

      {/* Warning si falta custom naming */}
      {customNamingRequired && !customNamingComplete && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-start gap-3">
          <span className="text-yellow-600 text-xl">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-700">
              Nombres de tarjetas requeridos
            </p>
            <p className="text-xs text-yellow-600 mt-1">
              Completá el nombre personalizado para las tarjetas listadas abajo.
            </p>
            <ul className="mt-1 text-xs text-yellow-600 list-disc list-inside">
              {detectedCards
                .filter(dc => {
                  const key = getCardKey(dc.bank, dc.card, dc.holders[0] || '')
                  return !customNamingEdits[key]?.custom_naming?.trim()
                })
                .map((dc, i) => (
                  <li key={i}>{dc.bank} · {dc.card}</li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {/* Summary card */}
      {currentSummary && (
        <div className="bg-[var(--color-base-container)] rounded-lg p-4 border border-[var(--border-color)] space-y-3">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Resumen</h2>

          {/* Tarjetas a crear */}
          {detectedCards.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {detectedCards.map((dc, idx) => {
                const key = getCardKey(dc.bank, dc.card, dc.holders[0] || '')
                const entry = customNamingEdits[key] || { custom_naming: dc.suggested_custom_naming, bank: dc.bank, card_name: dc.card, holder: dc.holders[0] }
                const suggestions = getSuggestionsForHolder(cards, entry.holder || dc.holders[0] || '')
                return (
                  <div key={idx} className={`p-3 bg-[var(--color-surface)] rounded-md border ${spotlightNaming && !entry.custom_naming?.trim() ? 'border-yellow-500 ring-2 ring-yellow-500/50' : 'border-[var(--border-color)]'}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold bg-[var(--color-primary)] text-[var(--color-on-primary)]">
                        💳
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-base-alt)] text-[var(--text-secondary)]">
                        {dc.transaction_count} gastos
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--text-secondary)] w-16">Nombre:</span>
                        <input
                          type="text"
                          list={`custom-naming-suggestions-${idx}`}
                          value={entry.custom_naming || ''}
                          onChange={e => setCustomNamingEdits(prev => ({ ...prev, [key]: { ...prev[key], custom_naming: e.target.value } }))}
                          placeholder="Nombre personalizado"
                          className={`flex-1 px-2 py-1 border rounded text-sm bg-[var(--color-base-container)] focus:outline-none focus:ring-2 transition ${
                            !entry.custom_naming?.trim()
                              ? 'border-red-500 focus:ring-red-500/30'
                              : 'border-[var(--border-color)] focus:ring-primary/30'
                          }`}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--text-secondary)] w-16">Tarjeta:</span>
                        <input
                          type="text"
                          value={entry.card_name || dc.card}
                          onChange={e => setCustomNamingEdits(prev => ({ ...prev, [key]: { ...prev[key], card_name: e.target.value } }))}
                          className="flex-1 px-2 py-1 border border-[var(--border-color)] rounded text-sm bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30"
                          placeholder="Tarjeta"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--text-secondary)] w-16">Banco:</span>
                        <input
                          type="text"
                          value={entry.bank || dc.bank}
                          onChange={e => setCustomNamingEdits(prev => ({ ...prev, [key]: { ...prev[key], bank: e.target.value } }))}
                          className="flex-1 px-2 py-1 border border-[var(--border-color)] rounded text-sm bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30"
                          placeholder="Banco"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--text-secondary)] w-16">Titular:</span>
                        <input
                          type="text"
                          value={titleCase(entry.holder || dc.holders[0] || '')}
                          onChange={e => setCustomNamingEdits(prev => ({ ...prev, [key]: { ...prev[key], holder: e.target.value } }))}
                          className="flex-1 px-2 py-1 border border-[var(--border-color)] rounded text-sm bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30"
                          placeholder="Titular"
                        />
                      </div>
                    </div>
                    <datalist id={`custom-naming-suggestions-${idx}`}>
                      {suggestions.map(name => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                )
              })}
            </div>
          )}

          {/* Info adicional */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs pt-2 border-t border-[var(--border-color)]">
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
      <div className="flex-1 overflow-y-auto min-h-0">
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
                  onClick={() => openRowDetail(row)}
                  className={`cursor-pointer border-b border-[var(--border-color)] hover:bg-[var(--color-base-alt)] transition ${
                    row.is_duplicate ? 'opacity-50 bg-yellow-500/10' : ''
                  } ${row.is_auto_generated ? 'bg-blue-500/5' : ''}`}
                >
                  <td className="py-2 px-4 whitespace-nowrap">{row.date}</td>
                  <td className="py-2 px-4">{toUpperCase(row.description)}</td>
                  <td className="py-2 px-4 whitespace-nowrap">
                    {row.amount} {row.currency}
                  </td>
                  <td className="py-2 px-4">{row.card || '-'}</td>
                  <td className="py-2 px-4">{row.bank || '-'}</td>
                  <td className="py-2 px-4">{titleCase(row.person) || '-'}</td>
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
      </div>

      {/* Stats */}
      <div className="flex-shrink-0 flex items-center gap-4 text-xs text-[var(--text-secondary)]">
        <span>Total: {rows.length}</span>
        <span>Duplicadas: {rows.filter((r: SmartImportRow) => r.is_duplicate).length}</span>
        <span>Programadas: {rows.filter((r: SmartImportRow) => (r as any).is_scheduled).length}</span>
        <span>Auto-generadas: {rows.filter((r: SmartImportRow) => r.is_auto_generated).length}</span>
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
                  <option key={person} value={titleCase(person)} />
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
                className="gnome-btn-primary flex-1"
              >
                Aplicar
              </button>
              <button
                onClick={() => setShowEditModal(false)}
                className="gnome-btn-secondary"
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
                className="gnome-btn-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDiscard}
                disabled={discardMutation.isPending}
                className="gnome-btn-danger"
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
                className="gnome-btn-secondary"
              >
                No, continuar
              </button>
              <button
                onClick={() => {
                  deleteMutation.mutate()
                  setShowCancelModal(false)
                }}
                disabled={deleteMutation.isPending}
                className="gnome-btn-danger"
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
                className="gnome-btn-primary"
              >
                Ver gastos
              </button>
            </div>
          </div>
        </div>
      )}

      <TransactionDetailModal
        isOpen={isRowDetailOpen}
        row={selectedRow}
        onClose={closeRowDetail}
      />

    </div>
  )
}
