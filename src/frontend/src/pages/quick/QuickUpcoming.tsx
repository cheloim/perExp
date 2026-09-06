import { useQuery } from "@tanstack/react-query";
import { getScheduledSummary, getRecurringExpenses } from "../../api/client";
import { formatCurrency, toUpperCase } from "../../utils/format";

interface UpcomingItem {
  description: string;
  amount: number;
  currency: string;
  date: string;
  type: string;
  card?: string;
}

function splitByCurrency(items: { amount: number; currency?: string }[]) {
  let ars = 0;
  let usd = 0;
  for (const i of items) {
    if (i.currency === "USD") usd += i.amount;
    else ars += i.amount;
  }
  return { ars, usd };
}

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

  // Build flat list with currency
  const allItems: UpcomingItem[] = [
    ...installments.map((i) => ({
      description: i.description,
      amount: i.amount,
      currency: i.currency,
      date: i.scheduled_date,
      type: `Cuota ${i.installment_number}/${i.installment_total}`,
      card: i.card,
    })),
    ...manual.map((m) => ({
      description: m.description,
      amount: m.amount,
      currency: m.currency,
      date: m.scheduled_date,
      type: "Programado",
      card: m.card,
    })),
    ...recurringActive.map((r) => ({
      description: r.description,
      amount: r.amount,
      currency: r.currency ?? "ARS",
      date: r.next_charge_date ?? "",
      type: `Recurrente · ${toUpperCase(r.frequency)}`,
    })),
  ];

  const totalCount = allItems.length;
  const { ars: totalArs, usd: totalUsd } = splitByCurrency(allItems);

  // Group by month
  const byMonth: Record<string, UpcomingItem[]> = {};
  for (const item of allItems) {
    if (!item.date) continue;
    const month = item.date.slice(0, 7);
    byMonth[month] = byMonth[month] ?? [];
    byMonth[month].push(item);
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
            {formatCurrency(totalArs)}
          </div>
          {totalUsd > 0 && (
            <div className="text-[10px] text-[var(--text-tertiary)]">
              + {formatCurrency(totalUsd, "USD")}
            </div>
          )}
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-3 text-center">
          <div className="text-[10px] text-[var(--text-secondary)]">Pagos</div>
          <div className="text-lg font-bold text-[var(--text-primary)]">{totalCount}</div>
        </div>
      </div>

      {/* Installments by month */}
      {sortedMonths.map((month) => {
        const items = byMonth[month];
        const { ars: monthArs, usd: monthUsd } = splitByCurrency(items);
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
                {formatCurrency(monthArs)}
                {monthUsd > 0 && ` + ${formatCurrency(monthUsd, "USD")}`}
              </span>
            </div>
            <div className="space-y-1.5">
              {items.map((item, i) => (
                <div key={`${item.date}-${i}`} className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[var(--color-base-alt)] flex items-center justify-center text-[10px] flex-shrink-0">
                    {item.type.startsWith("Cuota")
                      ? "💳"
                      : item.type.startsWith("Recurrente")
                        ? "🔄"
                        : "📋"}
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
                    {formatCurrency(item.amount, item.currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

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
