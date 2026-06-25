import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getImportJob,
  confirmImportJob,
  deleteImportJob,
  updateImportPreview,
} from "../api/client";
import { useState, useEffect } from "react";
import type { SmartImportRow, DetectedCard, CardsMapping } from "../types";
import { titleCase } from "../utils/format";
import { useModalWithData } from "../hooks/useModal";
import { TransactionDetailModal } from "../components/TransactionDetailModal";

function deriveCardHeader(rows: SmartImportRow[]): string {
  const counts = new Map<string, number>();
  rows
    .filter((r) => !r.is_duplicate && r.card_header)
    .forEach((r) => {
      counts.set(r.card_header, (counts.get(r.card_header) || 0) + 1);
    });
  let maxCount = 0;
  let consensus = "";
  counts.forEach((count, value) => {
    if (count > maxCount) {
      maxCount = count;
      consensus = value;
    }
  });
  return consensus;
}

export default function ImportJobPreview() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editedRows, setEditedRows] = useState<SmartImportRow[]>([]);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    scheduled: number;
    skipped: number;
  } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [cardMappings, setCardMappings] = useState<
    Record<string, { card_id?: number; bank?: string; card_name?: string }>
  >({});
  const {
    data: selectedRow,
    openWithData: openRowDetail,
    close: closeRowDetail,
    isOpen: isRowDetailOpen,
  } = useModalWithData<SmartImportRow>();

  useEffect(() => {
    if (!jobId) return;
    try {
      const stored = localStorage.getItem(`import_job_${jobId}_card_mappings`);
      if (stored) setCardMappings(JSON.parse(stored));
    } catch {}
  }, [jobId]);

  useEffect(() => {
    if (!jobId || Object.keys(cardMappings).length === 0) return;
    try {
      localStorage.setItem(`import_job_${jobId}_card_mappings`, JSON.stringify(cardMappings));
    } catch {}
  }, [cardMappings, jobId]);

  const {
    data: job,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["import-job", jobId],
    queryFn: () => getImportJob(Number(jobId)),
    enabled: !!jobId,
    retry: false,
  });

  const confirmMutation = useMutation({
    mutationFn: ({ rows, cardsMapping }: { rows: SmartImportRow[]; cardsMapping?: CardsMapping }) =>
      confirmImportJob(Number(jobId), rows, cardsMapping),
    onSuccess: (result: { imported: number; scheduled: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      setImportResult(result);
      setShowResultModal(true);
      try {
        localStorage.removeItem(`import_job_${jobId}_card_mappings`);
      } catch {}
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
      navigate("/expenses");
    },
  });

  const rows = editedRows.length > 0 ? editedRows : job?.preview_data?.rows || [];
  const detectedCards: DetectedCard[] = job?.preview_data?.detected_cards || [];

  const cardsMapping: CardsMapping = {};
  for (const dc of detectedCards) {
    const mapping = cardMappings[dc.card_header] || {};
    if (mapping.card_id) {
      cardsMapping[dc.card_header] = { card_id: mapping.card_id };
    } else if (mapping.bank && mapping.card_name) {
      cardsMapping[dc.card_header] = {
        bank: mapping.bank,
        card_name: mapping.card_name,
        card_type: dc.card_type,
      };
    }
  }

  const allMapped = detectedCards.every((dc) => {
    const m = cardMappings[dc.card_header];
    return m && (m.card_id || (m.bank && m.card_name));
  });
  const canImport = allMapped || detectedCards.length === 0;

  const handleConfirm = () => {
    if (!canImport) {
      setPageError("Mapeá todas las tarjetas antes de importar.");
      return;
    }
    confirmMutation.mutate({
      rows,
      cardsMapping: Object.keys(cardsMapping).length > 0 ? cardsMapping : undefined,
    });
  };

  const handleMappingChange = (cardHeader: string, field: string, value: string | number) => {
    setCardMappings((prev) => ({
      ...prev,
      [cardHeader]: { ...prev[cardHeader], [field]: value },
    }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[var(--text-tertiary)]">Cargando...</div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-[var(--text-secondary)]">
          {(error as any)?.status === 410
            ? "Esta importación expiró (TTL: 24h)"
            : "Error al cargar la importación"}
        </p>
        <button
          onClick={() => navigate("/expenses")}
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
        <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
        <p className="text-[var(--text-secondary)]">Procesando archivo...</p>
        <button
          onClick={() => discardMutation.mutate()}
          className="text-sm text-[var(--text-tertiary)] hover:text-red-500"
        >
          Cancelar procesamiento
        </button>
      </div>
    );
  }

  if (job.status === "FAILED") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-red-500">Error al procesar: {job.error_message}</p>
        <button
          onClick={() => navigate("/expenses")}
          className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm"
        >
          Volver
        </button>
      </div>
    );
  }

  const nonDuplicateCount = rows.filter((r) => !r.is_duplicate).length;
  const duplicateCount = rows.filter((r) => r.is_duplicate).length;
  const scheduledCount = rows.filter((r) => r.is_scheduled || r.installment_total).length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {pageError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center justify-between">
          <span>{pageError}</span>
          <button onClick={() => setPageError(null)} className="text-red-500 hover:text-red-700">
            ✕
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">{job.filename}</h1>
          <p className="text-sm text-[var(--text-tertiary)]">
            {nonDuplicateCount} transacciones · {duplicateCount} duplicadas
            {scheduledCount > 0 && ` · ${scheduledCount} cuotas`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowDiscardModal(true)}
            className="px-3 py-1.5 text-sm text-[var(--text-tertiary)] hover:text-red-500 border border-[var(--border-color)] rounded-lg"
          >
            Descartar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canImport || confirmMutation.isPending}
            className="px-4 py-1.5 text-sm bg-[var(--color-primary)] text-white rounded-lg disabled:opacity-50"
          >
            {confirmMutation.isPending ? "Importando..." : "Importar"}
          </button>
        </div>
      </div>

      {detectedCards.length > 0 && (
        <div className="mb-6 p-4 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg">
          <h2 className="text-sm font-medium text-[var(--text-primary)] mb-3">
            Tarjetas detectadas
          </h2>
          <div className="space-y-3">
            {detectedCards.map((dc) => {
              const mapping = cardMappings[dc.card_header] || {};
              const isMapped = mapping.card_id || (mapping.bank && mapping.card_name);
              return (
                <div
                  key={dc.card_header}
                  className={`p-3 rounded-lg border ${
                    isMapped
                      ? "border-green-200 bg-green-50"
                      : "border-[var(--border-color)] bg-[var(--color-base-alt)]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {dc.card_header || "Sin identificar"}
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)]">
                      {dc.transaction_count} transacciones
                    </span>
                  </div>
                  <div className="flex gap-2 items-center">
                    {dc.matched_card_id ? (
                      <span className="text-xs text-green-600">
                        ✓ Auto-mapeada a: {dc.matched_card_name}
                      </span>
                    ) : (
                      <>
                        <select
                          value={mapping.card_id || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "new") {
                              handleMappingChange(dc.card_header, "bank", dc.detected_bank || "");
                              handleMappingChange(
                                dc.card_header,
                                "card_name",
                                dc.detected_card || "",
                              );
                            } else if (val) {
                              setCardMappings((prev) => ({
                                ...prev,
                                [dc.card_header]: { card_id: Number(val) },
                              }));
                            }
                          }}
                          className="text-xs px-2 py-1 border border-[var(--border-color)] rounded bg-[var(--color-surface)]"
                        >
                          <option value="">Seleccionar tarjeta...</option>
                          <option value="new">Crear nueva</option>
                        </select>
                        {!mapping.card_id && (
                          <div className="flex gap-1">
                            <input
                              type="text"
                              placeholder="Banco"
                              value={mapping.bank || dc.detected_bank || ""}
                              onChange={(e) =>
                                handleMappingChange(dc.card_header, "bank", e.target.value)
                              }
                              className="text-xs px-2 py-1 border border-[var(--border-color)] rounded w-24"
                            />
                            <input
                              type="text"
                              placeholder="Tarjeta"
                              value={mapping.card_name || dc.detected_card || ""}
                              onChange={(e) =>
                                handleMappingChange(dc.card_header, "card_name", e.target.value)
                              }
                              className="text-xs px-2 py-1 border border-[var(--border-color)] rounded w-24"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-color)]">
              <th className="text-left py-2 px-4 text-[var(--text-tertiary)] font-medium">Fecha</th>
              <th className="text-left py-2 px-4 text-[var(--text-tertiary)] font-medium">
                Descripción
              </th>
              <th className="text-right py-2 px-4 text-[var(--text-tertiary)] font-medium">
                Monto
              </th>
              <th className="text-left py-2 px-4 text-[var(--text-tertiary)] font-medium">
                Tarjeta
              </th>
              <th className="text-left py-2 px-4 text-[var(--text-tertiary)] font-medium">
                Categoría
              </th>
              <th className="text-center py-2 px-4 text-[var(--text-tertiary)] font-medium">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={idx}
                onClick={() => openRowDetail(row)}
                className={`border-b border-[var(--border-color)] cursor-pointer hover:bg-[var(--color-base-alt)] ${
                  row.is_duplicate ? "opacity-50" : ""
                }`}
              >
                <td className="py-2 px-4">{row.date}</td>
                <td className="py-2 px-4 max-w-xs truncate">{row.description}</td>
                <td className="py-2 px-4 text-right">
                  {row.amount.toLocaleString("es-AR", {
                    style: "currency",
                    currency: row.currency === "USD" ? "USD" : "ARS",
                  })}
                </td>
                <td className="py-2 px-4">{row.card_header || "-"}</td>
                <td className="py-2 px-4">{row.suggested_category || "-"}</td>
                <td className="py-2 px-4 text-center">
                  {row.is_duplicate && (
                    <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded">
                      Duplicado
                    </span>
                  )}
                  {row.is_auto_generated && !row.is_duplicate && (
                    <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                      Cuota
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isRowDetailOpen && selectedRow && (
        <TransactionDetailModal row={selectedRow} onClose={closeRowDetail} />
      )}

      {showDiscardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
              Descartar importación
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Se eliminará esta importación y su notificación. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDiscardModal(false)}
                className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setShowDiscardModal(false);
                  discardMutation.mutate();
                }}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {showResultModal && importResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
              Importación completada
            </h2>
            <div className="space-y-1 text-sm text-[var(--text-secondary)] mb-4">
              <p>Importados: {importResult.imported}</p>
              <p>Cuotas programadas: {importResult.scheduled}</p>
              <p>Omitidos (duplicados): {importResult.skipped}</p>
            </div>
            <button
              onClick={() => {
                setShowResultModal(false);
                navigate("/expenses");
              }}
              className="w-full py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm"
            >
              Ver gastos
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
