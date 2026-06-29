import { DetailModal } from "./DetailModal";
import type { Expense } from "../types";
import { formatCurrency } from "../utils/format";

interface ExpenseDetailModalProps {
  expense: Expense | null;
  onClose: () => void;
  onEdit?: () => void;
}

export function ExpenseDetailModal({ expense, onClose, onEdit }: ExpenseDetailModalProps) {
  if (!expense) return null;

  return (
    <DetailModal
      isOpen={!!expense}
      onClose={onClose}
      title={expense.description}
      subtitle={expense.date}
    >
      <div className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-[var(--text-primary)]">
            {formatCurrency(expense.amount, expense.currency)}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <DetailField label="Categoría" value={expense.category_name || "Sin categoría"} />
          <DetailField label="Medio de pago" value={expense.card || expense.account || "-"} />
          {expense.installment_number && expense.installment_total && (
            <DetailField
              label="Cuotas"
              value={`${expense.installment_number}/${expense.installment_total}`}
            />
          )}
          {expense.notes && <DetailField label="Notas" value={expense.notes} />}
        </dl>

        <div className="flex gap-2 pt-4 border-t border-[var(--border-color)]">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition-colors"
          >
            Cerrar
          </button>
          {onEdit && (
            <button
              onClick={onEdit}
              className="flex-1 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:brightness-110 transition-colors"
            >
              Editar
            </button>
          )}
        </div>
      </div>
    </DetailModal>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--text-tertiary)] text-xs uppercase">{label}</dt>
      <dd className="text-[var(--text-primary)] font-medium text-sm">{value}</dd>
    </>
  );
}
