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
import { ConfirmDialog } from "./ConfirmDialog";
import { DetailModal } from "./DetailModal";

export default function AutoDetectedBanner() {
  const queryClient = useQueryClient();
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editFrequency, setEditFrequency] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

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
              {autoDetected.length !== 1 ? "s" : ""} auto-detectado
              {autoDetected.length !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">{merchants}</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => setShowReviewModal(true)}
              className="gnome-btn-primary-strong text-xs"
            >
              Revisar
            </button>
            <button onClick={() => dismissMut.mutate()} className="gnome-btn-secondary text-xs">
              Ocultar
            </button>
          </div>
        </div>
      </div>

      <DetailModal
        isOpen={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        title="Gastos auto-detectados"
        subtitle={`${autoDetected.length} gasto${
          autoDetected.length !== 1 ? "s" : ""
        } recurrente${autoDetected.length !== 1 ? "s" : ""}`}
        size="lg"
        footer={
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowReviewModal(false)}
              className="gnome-btn-secondary text-sm"
            >
              Cerrar
            </button>
            <button onClick={handleConfirmAll} className="gnome-btn-primary-strong text-sm">
              Confirmar todos
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {autoDetected.map((r) => (
            <div
              key={r.id}
              className="border border-[var(--border-color)] rounded-lg bg-[var(--color-base-alt)]/40 p-3"
            >
              {editingId === r.id ? (
                /* Edit form */
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      aria-label="Monto"
                      className="input flex-1"
                      placeholder="Monto"
                    />
                    <select
                      value={editFrequency}
                      onChange={(e) => setEditFrequency(e.target.value)}
                      aria-label="Frecuencia"
                      className="input"
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
                    aria-label="Próximo cargo"
                    className="input w-full"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setEditingId(null)}
                      className="gnome-btn-secondary text-xs"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => handleSaveEdit(r.id)}
                      className="gnome-btn-primary-strong text-xs"
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
                      <p className="text-xs text-[var(--text-secondary)]">
                        {formatCurrency(r.amount)}/
                        {r.frequency === "monthly"
                          ? "mes"
                          : r.frequency === "weekly"
                            ? "sem"
                            : r.frequency === "quarterly"
                              ? "trim"
                              : "año"}
                        {r.next_charge_date &&
                          ` · Próximo: ${new Date(
                            r.next_charge_date + "T00:00:00",
                          ).toLocaleDateString("es-AR")}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleStartEdit(r)}
                      className="gnome-btn-secondary text-xs"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => confirmMut.mutate(r.id)}
                      className="gnome-btn-primary-strong text-xs"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => setDeleteId(r.id)}
                      className="text-xs px-3 py-1.5 text-[var(--gnome-red-4)] hover:bg-[var(--gnome-red-4)]/10 rounded-lg transition"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </DetailModal>

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="Eliminar gasto recurrente"
        message="¿Eliminar este gasto recurrente? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (deleteId) {
            deleteMut.mutate(deleteId);
            setDeleteId(null);
          }
        }}
        onCancel={() => setDeleteId(null)}
        variant="danger"
      />
    </>
  );
}
