import { useQuery } from "@tanstack/react-query";
import { getScheduledSummary, getRecurringExpenses } from "../../api/client";
import { formatCurrency, toUpperCase } from "../../utils/format";

export default function QuickUpcoming() {
  const { data: scheduled, isLoading: schedLoading } = useQuery({
    queryKey: ["scheduled-summary", "quick"],
    queryFn: getScheduledSummary,
  });

  const { data: recurring, isLoading: recLoading } = useQuery({
    queryKey: ["recurring", "quick"],
    queryFn: () => getRecurringExpenses("active"),
  });

  const isLoading = schedLoading || recLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--text-secondary)] text-sm">
        Cargando...
      </div>
    );
  }

  const installments = scheduled?.installments ?? [];
  const manual = scheduled?.manual ?? [];
  const recurringActive = (recurring ?? []).filter(
    (r) => r.next_charge_date != null && new Date(r.next_charge_date) >= new Date(),
  );

  const totalUpcoming =
    installments.reduce((s, i) => s + i.amount, 0) +
    manual.reduce((s, m) => s + m.amount, 0) +
    recurringActive.reduce((s, r) => s + r.amount, 0);

  const totalCount = installments.length + manual.length + recurringActive.length;

  // Group by month
  const byMonth: Record<
    string,
    { description: string; amount: number; date: string; type: string; card?: string }[]
  > = {};

  for (const inst of installments) {
    const month = inst.scheduled_date.slice(0, 7); // YYYY-MM
    byMonth[month] = byMonth[month] ?? [];
    byMonth[month].push({
      description: inst.description,
      amount: inst.amount,
      date: inst.scheduled_date,
      type: `Cuota ${inst.installment_number}/${inst.installment_total}`,
      card: inst.card,
    });
  }
  for (const m of manual) {
    const month = m.scheduled_date.slice(0, 7);
    byMonth[month] = byMonth[month] ?? [];
    byMonth[month].push({
      description: m.description,
      amount: m.amount,
      date: m.scheduled_date,
      type: "Programado",
      card: m.card,
    });
  }

  const sortedMonths = Object.keys(byMonth).sort();

  const MONTH_NAMES = [
    "",
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
  ];

  return (
    <div className="p-4 space-y-3">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-3 text-center">
          <div className="text-[10px] text-[var(--text-secondary)]">Total próximo</div>
          <div className="text-lg font-bold text-[var(--text-primary)]">
            {formatCurrency(totalUpcoming)}
          </div>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-3 text-center">
          <div className="text-[10px] text-[var(--text-secondary)]">Pagos</div>
          <div className="text-lg font-bold text-[var(--text-primary)]">{totalCount}</div>
        </div>
      </div>

      {/* Installments by month */}
      {sortedMonths.map((month) => {
        const items = byMonth[month];
        const monthTotal = items.reduce((s, i) => s + i.amount, 0);
        const [y, m] = month.split("-");
        const label = `${MONTH_NAMES[parseInt(m, 10)]} ${y}`;

        return (
          <div
            key={month}
            className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider">
                {label}
              </span>
              <span className="text-[10px] font-bold text-[var(--text-primary)]">
                {formatCurrency(monthTotal)}
              </span>
            </div>
            <div className="space-y-1.5">
              {items.map((item, i) => (
                <div key={`${item.date}-${i}`} className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[var(--color-base-alt)] flex items-center justify-center text-[10px] flex-shrink-0">
                    {item.type.startsWith("Cuota") ? "💳" : "📋"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {item.description}
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)]">
                      {toUpperCase(item.type)}
                      {item.card ? ` · ${item.card}` : ""}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap">
                    {formatCurrency(item.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Recurring */}
      {recurringActive.length > 0 && (
        <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-3">
          <div className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-2">
            Suscripciones recurrentes
          </div>
          <div className="space-y-1.5">
            {recurringActive.map((r) => {
              const chargeDate = r.next_charge_date;
              const daysUntil = chargeDate
                ? Math.ceil((new Date(chargeDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null;
              const when =
                daysUntil === null
                  ? ""
                  : daysUntil === 0
                    ? "Hoy"
                    : daysUntil === 1
                      ? "Mañana"
                      : `En ${daysUntil}d`;
              return (
                <div key={r.id} className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[10px] flex-shrink-0">
                    🔄
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {r.description}
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)]">
                      {toUpperCase(r.frequency)} · {when}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap">
                    {formatCurrency(r.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {totalCount === 0 && (
        <div className="text-center py-12 text-[var(--text-secondary)] text-sm">
          <div className="text-3xl mb-2">📅</div>
          <p>No hay pagos próximos.</p>
        </div>
      )}
    </div>
  );
}
