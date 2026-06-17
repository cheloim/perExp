import { DetailModal } from "./DetailModal";
import type { SmartImportRow } from "../types";
import { toUpperCase } from "../utils/format";

interface TransactionDetailModalProps {
  isOpen: boolean;
  row: SmartImportRow | null;
  onClose: () => void;
}

export function TransactionDetailModal({ isOpen, row, onClose }: TransactionDetailModalProps) {
  if (!row) return null;

  return (
    <DetailModal
      isOpen={isOpen}
      onClose={onClose}
      title={toUpperCase(row.description)}
      subtitle={row.date}
    >
      <div className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-[var(--text-primary)]">
            {row.amount.toLocaleString("es-AR")} {row.currency}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <DetailField label="Tarjeta" value={row.card || "-"} />
          <DetailField label="Banco" value={row.bank || "-"} />
          <DetailField label="Persona" value={row.person || "-"} />
          <DetailField label="Categoría" value={row.suggested_category || "-"} />
          <DetailField
            label="Cuotas"
            value={
              row.installment_total && row.installment_total > 1
                ? `${row.installment_number ?? 1}/${row.installment_total}`
                : "-"
            }
          />
          <DetailField label="Transaction ID" value={row.transaction_id || "-"} />
        </dl>

        {(row.is_duplicate || row.is_auto_generated) && (
          <div className="flex gap-2 flex-wrap pt-2">
            {row.is_duplicate && (
              <span className="text-xs bg-warning/10 text-warning px-2 py-1 rounded">
                Duplicada
              </span>
            )}
            {row.is_auto_generated && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                Auto-generada
              </span>
            )}
          </div>
        )}
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
