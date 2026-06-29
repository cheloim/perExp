import { DetailModal } from "./DetailModal";
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
    <DetailModal
      isOpen={true}
      onClose={onClose}
      title={toUpperCase(expense.description)}
      subtitle={formatDateDMY(expense.date)}
    >
      <div className="space-y-4">
        {/* Monto */}
        <div className="bg-[var(--color-base-alt)] rounded-lg p-4 text-center">
          <span className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            {formatCurrency(expense.amount, expense.currency)}
          </span>
        </div>

        {/* Detail grid */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <DetailField label="Fecha" value={formatDateDMY(expense.date)} />
          <DetailField label="Cuenta" value={accountLabel} />
          <div>
            <dt className="text-[var(--text-tertiary)] text-xs uppercase">Categoría</dt>
            <dd>
              {expense.category_name ? (
                <span
                  className="px-2 py-0.5 rounded text-xs font-medium"
                  style={{ backgroundColor: categoryColor + "20", color: categoryColor }}
                >
                  {expense.category_name}
                </span>
              ) : (
                "—"
              )}
            </dd>
          </div>
          {expense.installment_number && expense.installment_total && (
            <DetailField
              label="Cuotas"
              value={`${expense.installment_number} / ${expense.installment_total}`}
            />
          )}
        </dl>

        {/* Notas */}
        <div className="border-t border-[var(--border-color)] pt-3">
          <p className="text-[var(--text-tertiary)] text-xs uppercase mb-1">Notas</p>
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            {expense.notes || "—"}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-[var(--border-color)]">
          <button onClick={onClose} className="gnome-btn-secondary flex-1 text-sm">
            Cerrar
          </button>
          <button onClick={onEdit} className="gnome-btn-primary flex-1 text-sm">
            Editar
          </button>
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
