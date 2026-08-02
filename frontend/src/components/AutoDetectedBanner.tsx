import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAutoDetectedRecurring,
  confirmRecurringExpense,
  deleteRecurringExpense,
  updateRecurringExpense,
  dismissAutoDetectedBanner,
} from "../api/client";
import type { RecurringExpense } from "../api/client";
import { formatCurrency } from "../utils/format";

export default function AutoDetectedBanner() {
  const queryClient = useQueryClient();
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editFrequency, setEditFrequency] = useState("");

  const { data: autoDetected = [] } = useQuery({
    queryKey: ["recurring", "auto-detected"],
    queryFn: getAutoDetectedRecurring,
    staleTime: 60_000,
  });

  const dismissMut = useMutation({
    mutationFn: dismissAutoDetectedBanner,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
    },
  });

  const confirmMut = useMutation({
    mutationFn: (id: number) => confirmRecurringExpense(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      queryClient.invalidateQueries({ queryKey: ["recurring", "auto-detected"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRecurringExpense(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      queryClient.invalidateQueries({ queryKey: ["recurring", "auto-detected"] });
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      updateRecurringExpense(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      queryClient.invalidateQueries({ queryKey: ["recurring", "auto-detected"] });
      setEditingId(null);
    },
  });

  const handleConfirmAll = () => {
    autoDetected.forEach((r) => confirmMut.mutate(r.id));
    setShowReviewModal(false);
  };

  const handleStartEdit = (r: RecurringExpense) => {
    setEditingId(r.id);
    setEditAmount(String(r.amount));
    setEditDate(r.next_charge_date || "");
    setEditFrequency(r.frequency);
  };

  const handleSaveEdit = (id: number) => {
    confirmMut.mutate(id, {
      onSuccess: () => {
        updateMut.mutate({
          id,
          data: {
            amount: parseFloat(editAmount),
            next_charge_date: editDate || undefined,
            frequency: editFrequency,
          },
        });
      },
    });
  };

  if (autoDetected.length === 0) return null;

  const merchants = autoDetected.map((r) => r.merchant_key).join(", ");

  return (
    <>
      {/* Banner */}
      <div className="card bg-[var(--gnome-purple-5)]/10 border border-[var(--gnome-purple-3)]/30 p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl flex-shrink-0">🤖</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {autoDetected.length} gasto{autoDetected.length !== 1 ? "s" : ""} recurrente
              {autoDetected.length !== 1 ? "s" : ""} auto-detectado{autoDetected.length !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">{merchants}</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => setShowReviewModal(true)}
              className="text-xs px-3 py-1.5 bg-[var(--color-primary)] text-white rounded-lg font-medium hover:opacity-90 transition"
            >
              Revisar
            </button>
            <button
              onClick={() => dismissMut.mutate()}
              className="text-xs px-3 py-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition"
            >
              Ocultar
            </button>
          </div>
        </div>
      </div>

      {/* Review Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg max-h-[80vh] overflow-y-auto p-0">
            {/* Header */}
            <div className="bg-gradient-to-r from-[var(--gnome-purple-3)] to-[var(--color-primary)] p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">🤖 Gastos auto-detectados</h2>
                  <p className="text-sm text-white/80">
                    {autoDetected.length} gasto{autoDetected.length !== 1 ? "s" : ""} recurrente
                    {autoDetected.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <button
                  onClick={() => setShowReviewModal(false)}
                  className="text-white/80 hover:text-white text-xl"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Items */}
            <div className="p-4 space-y-3">
              {autoDetected.map((r) => (
                <div key={r.id} className="border border-[var(--border-color)] rounded-lg p-3">
                  {editingId === r.id ? (
                    /* Edit form */
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className="flex-1 text-sm bg-[var(--color-base-container)] border border-[var(--border-color)] rounded px-2 py-1.5"
                          placeholder="Monto"
                        />
                        <select
                          value={editFrequency}
                          onChange={(e) => setEditFrequency(e.target.value)}
                          className="text-sm bg-[var(--color-base-container)] border border-[var(--border-color)] rounded px-2 py-1.5"
                        >
                          <option value="weekly">Semanal</option>
                          <option value="monthly">Mensual</option>
                          <option value="quarterly">Trimestral</option>
                          <option value="yearly">Anual</option>
                        </select>
                      </div>
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="w-full text-sm bg-[var(--color-base-container)] border border-[var(--border-color)] rounded px-2 py-1.5"
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs px-3 py-1.5 text-[var(--text-tertiary)]"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => handleSaveEdit(r.id)}
                          className="text-xs px-3 py-1.5 bg-[var(--color-primary)] text-white rounded-lg font-medium"
                        >
                          Guardar y confirmar
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Display */
                    <div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-[var(--text-primary)]">
                            {r.merchant_key}
                          </p>
                          <p className="text-xs text-[var(--text-tertiary)]">
                            {formatCurrency(r.amount)}/
                            {r.frequency === "monthly"
                              ? "mes"
                              : r.frequency === "weekly"
                                ? "sem"
                                : r.frequency === "quarterly"
                                  ? "trim"
                                  : "año"}
                            {r.next_charge_date &&
                              ` · Próximo: ${new Date(r.next_charge_date + "T00:00:00").toLocaleDateString("es-AR")}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleStartEdit(r)}
                          className="text-xs px-3 py-1.5 border border-[var(--border-color)] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => confirmMut.mutate(r.id)}
                          className="text-xs px-3 py-1.5 bg-[var(--color-success)] text-white rounded-lg font-medium hover:opacity-90 transition"
                        >
                          Confirmar
                        </button>
                        <button
                          onClick={() => {
                            if (confirm("Eliminar este gasto recurrente?")) {
                              deleteMut.mutate(r.id);
                            }
                          }}
                          className="text-xs px-3 py-1.5 text-[var(--color-error)] hover:bg-[var(--color-error)]/10 rounded-lg transition"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-4 pb-4 flex gap-2 justify-end">
              <button
                onClick={() => setShowReviewModal(false)}
                className="text-sm px-4 py-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition"
              >
                Cerrar
              </button>
              <button
                onClick={handleConfirmAll}
                className="text-sm px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-medium hover:opacity-90 transition"
              >
                Confirmar todos
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
