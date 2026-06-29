import { useEffect } from "react";
import type { Expense } from "../types";
import { formatCurrency, toUpperCase, formatDateDMY, getContrastTextColor } from "../utils/format";

interface Props {
  expense: Expense;
  onClose: () => void;
  onEdit: () => void;
}

export default function ExpenseDetailModal({ expense, onClose, onEdit }: Props) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const accountLabel = expense.card
    ? `${expense.card}${expense.bank ? ` · ${expense.bank}` : ""}`
    : expense.bank || "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-backdrop">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative card w-full max-w-md p-6 space-y-4 animate-modal-content">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] truncate pr-4">
            {toUpperCase(expense.description)}
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="text-[var(--text-tertiary)] hover:text-[var(--color-primary)] flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Detail grid */}
        <div className="space-y-3">
          {/* Monto */}
          <div className="flex items-center justify-between p-3 bg-[var(--color-base-alt)] rounded-lg">
            <span className="text-xs text-[var(--text-secondary)]">Monto</span>
            <span className="text-base font-bold text-[var(--text-primary)]">
              {formatCurrency(expense.amount, expense.currency)}
            </span>
          </div>

          {/* Fecha */}
          <div className="flex items-center justify-between px-1 py-2 border-b border-[var(--border-color)]">
            <span className="text-xs text-[var(--text-secondary)]">Fecha</span>
            <span className="text-sm text-[var(--text-primary)]">{formatDateDMY(expense.date)}</span>
          </div>

          {/* Categoría */}
          <div className="flex items-center justify-between px-1 py-2 border-b border-[var(--border-color)]">
            <span className="text-xs text-[var(--text-secondary)]">Categoría</span>
            {expense.category_name ? (
              <span
                className="px-2 py-0.5 rounded text-xs font-medium"
                style={{
                  backgroundColor: (expense.category_color || "#9a9996") + "20",
                  color: getContrastTextColor(expense.category_color || "#9a9996"),
                }}
              >
                {expense.category_name}
              </span>
            ) : (
              <span className="text-xs text-[var(--text-tertiary)]">—</span>
            )}
          </div>

          {/* Cuenta */}
          <div className="flex items-center justify-between px-1 py-2 border-b border-[var(--border-color)]">
            <span className="text-xs text-[var(--text-secondary)]">Cuenta</span>
            <span className="text-sm text-[var(--text-primary)]">{accountLabel}</span>
          </div>

          {/* Cuotas */}
          {expense.installment_number && expense.installment_total && (
            <div className="flex items-center justify-between px-1 py-2 border-b border-[var(--border-color)]">
              <span className="text-xs text-[var(--text-secondary)]">Cuotas</span>
              <span className="text-sm text-[var(--text-primary)]">
                {expense.installment_number} / {expense.installment_total}
              </span>
            </div>
          )}

          {/* Notas */}
          {expense.notes && (
            <div className="px-1 py-2 border-b border-[var(--border-color)]">
              <span className="text-xs text-[var(--text-secondary)]">Notas</span>
              <p className="text-sm text-[var(--text-primary)] mt-1 whitespace-pre-wrap">{expense.notes}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
          >
            Cerrar
          </button>
          <button
            onClick={onEdit}
            className="flex-1 px-4 py-2 rounded-md bg-[var(--color-primary)] text-white text-sm font-medium hover:brightness-110 transition"
          >
            Editar
          </button>
        </div>
      </div>
    </div>
  );
}
