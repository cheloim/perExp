import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getImportJob, confirmImportJob, deleteImportJob, getCards } from "../api/client";
import { useState, useEffect } from "react";
import type { SmartImportRow, DetectedCard, CardsMapping, Card } from "../types";
import { formatCurrency } from "../utils/format";
import { useModalWithData } from "../hooks/useModal";
import { TransactionDetailModal } from "../components/TransactionDetailModal";
import { Select } from "../components/ui/Select";
import { useNotifications } from "../context/NotificationsContext";

export default function ImportJobPreview() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refresh } = useNotifications();

  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    scheduled: number;
    skipped: number;
  } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [showNewCard, setShowNewCard] = useState(false);
  const [newBank, setNewBank] = useState("");
  const [newCardName, setNewCardName] = useState("");
  const {
    data: selectedRow,
    openWithData: openRowDetail,
    close: closeRowDetail,
    isOpen: isRowDetailOpen,
  } = useModalWithData<SmartImportRow>();

  const {
    data: job,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["import-job", jobId],
    queryFn: () => getImportJob(Number(jobId)),
    enabled: !!jobId,
    retry: false,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (job?.status === "PROCESSING") return 3000;
      return false;
    },
  });

  const { data: userCards = [] } = useQuery({
    queryKey: ["cards"],
    queryFn: getCards,
  });

  const confirmMutation = useMutation({
    mutationFn: ({
      rows,
      cardsMapping,
      closingDate,
      dueDate,
    }: {
      rows: SmartImportRow[];
      cardsMapping?: CardsMapping;
      closingDate?: string | null;
      dueDate?: string | null;
    }) => confirmImportJob(Number(jobId), rows, cardsMapping, closingDate, dueDate),
    onSuccess: (result: { imported: number; scheduled: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
      refresh();
      setImportResult(result);
      setShowResultModal(true);
    },
    onError: (err: any) => {
      setPageError(err?.response?.data?.detail || err.message || "Error al importar");
    },
  });

  const discardMutation = useMutation({
    mutationFn: () => deleteImportJob(Number(jobId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
      navigate("/");
    },
  });

  const rows = job?.preview_data?.rows || [];
  const detectedCards: DetectedCard[] = job?.preview_data?.detected_cards || [];
  const summary = job?.preview_data?.summary;
  const closingDateStr = summary?.closing_date ?? null;
  const dueDateStr = summary?.due_date ?? null;

  // Auto-select first matched card if available
  useEffect(() => {
    if (detectedCards.length > 0 && selectedCardId === null) {
      const matched = detectedCards.find((dc) => dc.matched_card_id);
      if (matched?.matched_card_id) {
        setSelectedCardId(matched.matched_card_id);
      }
    }
  }, [detectedCards, selectedCardId]);

  const nonDuplicateCount = rows.filter((r) => !r.is_duplicate).length;
  const duplicateCount = rows.filter((r) => r.is_duplicate).length;
  const scheduledCount = rows.filter((r) => r.is_scheduled || r.installment_total).length;
  const uniqueCards = [...new Set(rows.map((r) => r.card_header).filter(Boolean))];

  const handleConfirm = () => {
    const cardsMapping: CardsMapping = {};
    if (detectedCards.length > 0) {
      if (showNewCard && newBank && newCardName) {
        // Create new card
        for (const dc of detectedCards) {
          cardsMapping[dc.card_header] = {
            bank: newBank,
            card_name: newCardName,
            card_type: dc.card_type,
          };
        }
      } else if (selectedCardId) {
        // Use existing card
        for (const dc of detectedCards) {
          cardsMapping[dc.card_header] = { card_id: selectedCardId };
        }
      }
    }
    confirmMutation.mutate({
      rows,
      cardsMapping: Object.keys(cardsMapping).length > 0 ? cardsMapping : undefined,
      closingDate: job?.preview_data?.summary?.closing_date ?? null,
      dueDate: job?.preview_data?.summary?.due_date ?? null,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-[var(--text-tertiary)]">
          <div className="w-5 h-5 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Cargando...</span>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-4xl opacity-30">📄</div>
        <p className="text-[var(--text-secondary)] text-sm">
          {"status" in (error || {}) && (error as { status?: number }).status === 410
            ? "Esta importación expiró (TTL: 24h)"
            : "Error al cargar la importación"}
        </p>
        <button
          onClick={() => navigate("/")}
          className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm"
        >
          Volver
        </button>
      </div>
    );
  }

  if (job.status === "PROCESSING") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-10 h-10 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
        <div className="text-center">
          <p className="text-[var(--text-primary)] font-medium">Procesando archivo</p>
          <p className="text-[var(--text-tertiary)] text-sm mt-1">
            La IA está analizando tus transacciones...
          </p>
        </div>
        <button
          onClick={() => discardMutation.mutate()}
          className="text-sm text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
        >
          Cancelar
        </button>
      </div>
    );
  }

  if (job.status === "FAILED") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-4xl opacity-30">⚠️</div>
        <div className="text-center">
          <p className="text-red-500 font-medium">Error al procesar</p>
          <p className="text-[var(--text-tertiary)] text-sm mt-1 max-w-md">{job.error_message}</p>
        </div>
        <button
          onClick={() => navigate("/")}
          className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm"
        >
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {pageError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center justify-between">
          <span>{pageError}</span>
          <button onClick={() => setPageError(null)} className="text-red-500 hover:text-red-700">
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">{job.filename}</h1>
          <p className="text-sm text-[var(--text-tertiary)]">
            {nonDuplicateCount} transacciones
            {duplicateCount > 0 && ` · ${duplicateCount} duplicadas`}
            {scheduledCount > 0 && ` · ${scheduledCount} cuotas`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowDiscardModal(true)}
            className="px-3 py-1.5 text-sm text-[var(--text-tertiary)] hover:text-red-500 border border-[var(--border-color)] rounded-lg transition-colors"
          >
            Descartar
          </button>
          <button
            onClick={handleConfirm}
            disabled={
              (!selectedCardId && !(showNewCard && newBank && newCardName)) ||
              confirmMutation.isPending
            }
            className="px-4 py-1.5 text-sm bg-[var(--color-primary)] text-white rounded-lg disabled:opacity-50 transition-opacity"
          >
            {confirmMutation.isPending ? "Importando..." : "Importar"}
          </button>
        </div>
      </div>

      {/* Import Summary Card */}
      <div className="mb-6 p-4 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg">
        <div className="flex items-center gap-2 mb-3">
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            className="text-[var(--color-primary)]"
          >
            <path
              d="M9 16H4a2 2 0 01-2-2V6a2 2 0 012-2h12a2 2 0 012 2v5M15 11l-5 5m0 0l-5-5m5 5V3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-sm font-medium text-[var(--text-primary)]">
            Resumen de importación
          </span>
        </div>

        <p className="text-sm text-[var(--text-secondary)] mb-3">
          Se importarán <strong>{nonDuplicateCount} transacciones</strong>
          {scheduledCount > 0 && `, de las cuales ${scheduledCount} son cuotas futuras`}
          {duplicateCount > 0 && (
            <span className="text-[var(--text-tertiary)]">
              {" "}
              ({duplicateCount} duplicadas serán omitidas)
            </span>
          )}
        </p>

        {/* Billing period info */}
        {(closingDateStr || dueDateStr) && (
          <div className="flex items-center gap-4 mb-3 px-3 py-2 bg-[var(--color-base-alt)] rounded-md text-xs text-[var(--text-secondary)]">
            {closingDateStr && (
              <span>📅 Cierra: <strong>{closingDateStr}</strong></span>
            )}
            {dueDateStr && (
              <span>💳 Vence: <strong>{dueDateStr}</strong></span>
            )}
          </div>
        )}

        {/* Card Selection */}
        {detectedCards.length > 0 && (
          <div className="mt-3">
            <label className="text-xs text-[var(--text-tertiary)] mb-1 block">
              Tarjeta de destino
            </label>
            <Select
              value={showNewCard ? "new" : selectedCardId?.toString() || ""}
              onChange={(val) => {
                if (val === "new") {
                  setShowNewCard(true);
                  setSelectedCardId(null);
                } else {
                  setShowNewCard(false);
                  setSelectedCardId(Number(val) || null);
                  setNewBank("");
                  setNewCardName("");
                }
              }}
              options={[
                ...userCards.map((card: Card) => ({
                  value: card.id.toString(),
                  label: `${card.card_name}${card.bank ? ` - ${card.bank}` : ""}`,
                })),
                { value: "new", label: "Otro (crear nueva)" },
              ]}
              placeholder="Seleccionar tarjeta..."
              className="max-w-md"
            />
            {showNewCard && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  placeholder="Banco"
                  value={newBank}
                  onChange={(e) => setNewBank(e.target.value)}
                  className="flex-1 text-sm px-3 py-2 border border-[var(--border-color)] rounded-lg bg-[var(--color-surface)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                />
                <input
                  type="text"
                  placeholder="Tarjeta"
                  value={newCardName}
                  onChange={(e) => setNewCardName(e.target.value)}
                  className="flex-1 text-sm px-3 py-2 border border-[var(--border-color)] rounded-lg bg-[var(--color-surface)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                />
              </div>
            )}
          </div>
        )}

        {uniqueCards.length > 0 && (
          <div className="mt-2 text-xs text-[var(--text-tertiary)]">
            Tarjeta detectada: {uniqueCards.join(", ")}
          </div>
        )}
      </div>

      {/* Transactions Table */}
      <div className="overflow-x-auto border border-[var(--border-color)] rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-color)] bg-[var(--color-base-alt)]">
              <th className="text-left py-2.5 px-4 text-[var(--text-tertiary)] font-medium text-xs uppercase tracking-wide">
                Fecha
              </th>
              <th className="text-left py-2.5 px-4 text-[var(--text-tertiary)] font-medium text-xs uppercase tracking-wide">
                Descripción
              </th>
              <th className="text-right py-2.5 px-4 text-[var(--text-tertiary)] font-medium text-xs uppercase tracking-wide">
                Monto
              </th>
              <th className="text-left py-2.5 px-4 text-[var(--text-tertiary)] font-medium text-xs uppercase tracking-wide">
                Categoría
              </th>
              <th className="text-center py-2.5 px-4 text-[var(--text-tertiary)] font-medium text-xs uppercase tracking-wide">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={idx}
                onClick={() => openRowDetail(row)}
                className={`border-b border-[var(--border-color)] last:border-0 cursor-pointer transition-colors ${
                  row.is_duplicate
                    ? "opacity-50 bg-[var(--color-base-alt)]"
                    : "hover:bg-[var(--color-base-alt)]"
                }`}
              >
                <td className="py-2.5 px-4 text-[var(--text-secondary)]">{row.date}</td>
                <td className="py-2.5 px-4 text-[var(--text-primary)] max-w-xs truncate">
                  {row.description}
                </td>
                <td className="py-2.5 px-4 text-right font-medium text-[var(--text-primary)]">
                  {formatCurrency(row.amount, row.currency)}
                </td>
                <td className="py-2.5 px-4 text-[var(--text-secondary)]">
                  {row.suggested_category || <span className="text-[var(--text-tertiary)]">—</span>}
                </td>
                <td className="py-2.5 px-4 text-center">
                  {row.is_duplicate && (
                    <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                      Duplicado
                    </span>
                  )}
                  {row.is_auto_generated && !row.is_duplicate && (
                    <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                      Cuota
                    </span>
                  )}
                  {!row.is_duplicate && !row.is_auto_generated && (
                    <span className="text-xs text-[var(--text-tertiary)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--border-color)] bg-[var(--color-base-alt)]">
              <td
                colSpan={2}
                className="py-2.5 px-4 text-xs text-[var(--text-tertiary)] font-medium"
              >
                Total ({nonDuplicateCount} transacciones)
              </td>
              <td className="py-2.5 px-4 text-right font-semibold text-[var(--text-primary)]">
                {(() => {
                  const nonDupRows = rows.filter((r) => !r.is_duplicate);
                  const arsTotal = nonDupRows
                    .filter((r) => r.currency === "ARS")
                    .reduce((sum, r) => sum + r.amount, 0);
                  const usdTotal = nonDupRows
                    .filter((r) => r.currency === "USD")
                    .reduce((sum, r) => sum + r.amount, 0);

                  if (arsTotal > 0 && usdTotal > 0) {
                    return (
                      <span className="text-xs">
                        {formatCurrency(arsTotal, "ARS")} + {formatCurrency(usdTotal, "USD")}
                      </span>
                    );
                  }
                  return formatCurrency(arsTotal || usdTotal, arsTotal > 0 ? "ARS" : "USD");
                })()}
              </td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {rows.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl opacity-30 mb-3">📭</div>
          <p className="text-[var(--text-tertiary)] text-sm">No se encontraron transacciones</p>
        </div>
      )}

      {/* Modals */}
      {isRowDetailOpen && selectedRow && (
        <TransactionDetailModal row={selectedRow} onClose={closeRowDetail} />
      )}

      {showDiscardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
              Descartar importación
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Se eliminará esta importación y su notificación. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDiscardModal(false)}
                className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm hover:bg-[var(--color-base-alt)] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setShowDiscardModal(false);
                  discardMutation.mutate();
                }}
                className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm transition-colors"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {showResultModal && importResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">✅</div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                Importación completada
              </h2>
            </div>
            <div className="space-y-2 text-sm text-[var(--text-secondary)] mb-4">
              <div className="flex justify-between">
                <span>Importados</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {importResult.imported}
                </span>
              </div>
              {importResult.scheduled > 0 && (
                <div className="flex justify-between">
                  <span>Cuotas programadas</span>
                  <span className="font-medium text-[var(--text-primary)]">
                    {importResult.scheduled}
                  </span>
                </div>
              )}
              {importResult.skipped > 0 && (
                <div className="flex justify-between">
                  <span>Duplicados omitidos</span>
                  <span className="text-[var(--text-tertiary)]">{importResult.skipped}</span>
                </div>
              )}
            </div>
            <button
              onClick={() => {
                setShowResultModal(false);
                navigate("/");
              }}
              className="w-full py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:brightness-110 transition-all"
            >
              Ver gastos
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
