import { useEffect } from "react";
import type { Expense } from "../types";
import { formatCurrency, toUpperCase, formatDateDMY } from "../utils/format";

interface Props {
  expense: Expense;
  onClose: () => void;
  onEdit: () => void;
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  cuenta_corriente: "Cta. Corriente",
  caja_ahorro: "Caja de Ahorro",
  mercadopago: "MercadoPago",
};

export default function ExpenseDetailModal({ expense, onClose, onEdit }: Props) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const accountLabel = (() => {
    if (expense.card) {
      return `${expense.card}${expense.bank ? ` · ${expense.bank}` : ""}`;
    }
    if (expense.account_rel?.name) {
      const typeLabel = ACCOUNT_TYPE_LABELS[expense.account_rel.type] || expense.account_rel.type;
      return `${expense.account_rel.name} (${typeLabel})`;
    }
    if (expense.bank) return expense.bank;
    return "—";
  })();

  const categoryColor = expense.category_color || "#9a9996";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-backdrop">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative card w-full max-w-sm p-5 space-y-4 animate-modal-content">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-primary)] truncate pr-4">
            {toUpperCase(expense.description)}
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="w-7 h-7 flex items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--color-base-alt)] transition"
          >
            ✕
          </button>
        </div>

        {/* Monto - highlighted block */}
        <div className="bg-[var(--color-base-alt)] rounded-lg p-4 text-center">
          <span className="text-2xl font-bold text-[var(--text-primary)]">
            {formatCurrency(expense.amount, expense.currency)}
          </span>
        </div>

        {/* Detail rows */}
        <div className="space-y-0">
          <DetailRow label="Fecha" value={formatDateDMY(expense.date)} />
          <DetailRow
            label="Categoría"
            value={
              expense.category_name ? (
                <span
                  className="px-2 py-0.5 rounded text-xs font-medium"
                  style={{
                    backgroundColor: categoryColor + "20",
                    color: categoryColor,
                  }}
                >
                  {expense.category_name}
                </span>
              ) : (
                "—"
              )
            }
          />
          <DetailRow label="Cuenta" value={accountLabel} />
          {expense.installment_number && expense.installment_total && (
            <DetailRow
              label="Cuotas"
              value={`${expense.installment_number} / ${expense.installment_total}`}
            />
          )}
          <DetailRow label="Notas" value={expense.notes || "—"} truncate />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
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

function DetailRow({
  label,
  value,
  truncate,
}: {
  label: string;
  value: React.ReactNode;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-1 py-2 border-b border-[var(--border-color)] last:border-b-0">
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <span
        className={`text-sm text-[var(--text-primary)] text-right ${truncate ? "max-w-[60%] truncate" : ""}`}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}
