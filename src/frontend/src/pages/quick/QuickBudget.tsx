import { useQuery } from "@tanstack/react-query";
import { getBudgetGroups, getBudgetSummary } from "../../api/client";
import { formatCurrency } from "../../utils/format";

export default function QuickBudget() {
  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ["budget-groups", "quick"],
    queryFn: getBudgetGroups,
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["budget-summary", "quick"],
    queryFn: () => getBudgetSummary(),
  });

  const isLoading = groupsLoading || summaryLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--text-secondary)] text-sm">
        Cargando...
      </div>
    );
  }

  const totalBudget = summary?.total_budget ?? 0;
  const totalSpent = summary?.total_spent ?? 0;
  const totalPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  const flagged = (summary?.categories ?? []).filter(
    (c) => c.status === "warning" || c.status === "exceeded",
  );

  return (
    <div className="p-4 space-y-3">
      {/* Total KPI */}
      <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider">
            Presupuesto del mes
          </span>
          <span className="text-xs font-bold text-[var(--text-primary)]">
            {totalPct}% utilizado
          </span>
        </div>
        <div className="h-3 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              totalPct >= 100
                ? "bg-[var(--gnome-red-4)]"
                : totalPct >= 80
                  ? "bg-[var(--gnome-orange-4)]"
                  : "bg-[var(--gnome-green-5)]"
            }`}
            style={{ width: `${Math.min(totalPct, 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[10px] text-[var(--text-secondary)]">
          <span>{formatCurrency(totalSpent)} gastado</span>
          <span>{formatCurrency(totalBudget)} total</span>
        </div>
      </div>

      {/* Macro groups */}
      {groups && groups.length > 0 && (
        <div className="space-y-2">
          {groups.map((g) => {
            const pct = g.amount > 0 ? Math.round((g.spent / g.amount) * 100) : 0;
            const status =
              pct >= 100 ? "exceeded" : pct >= 80 ? "warning" : "ok";
            const barColor =
              status === "exceeded"
                ? "var(--gnome-red-4)"
                : status === "warning"
                  ? "var(--gnome-orange-4)"
                  : "var(--gnome-green-5)";
            const emoji =
              g.name === "necesidades" ? "🏠" : g.name === "gustos" ? "🎉" : "💰";

            return (
              <div
                key={g.id}
                className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-3"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{emoji}</span>
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      {g.display_name}
                    </span>
                  </div>
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: barColor }}
                  >
                    {pct}%
                  </span>
                </div>
                <div className="h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(pct, 100)}%`,
                      backgroundColor: barColor,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1 text-[10px] text-[var(--text-secondary)]">
                  <span>{formatCurrency(g.spent)}</span>
                  <span>de {formatCurrency(g.amount)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Flagged categories */}
      {flagged.length > 0 && (
        <div className="bg-[var(--gnome-orange-1)] border border-[var(--gnome-orange-3)] rounded-xl p-3">
          <div className="text-[10px] font-semibold text-[var(--gnome-orange-5)] uppercase tracking-wider mb-2">
            Alertas de presupuesto
          </div>
          <div className="space-y-1.5">
            {flagged.slice(0, 5).map((c) => (
              <div key={c.category_id ?? c.category_name} className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-primary)] font-medium truncate">
                  {c.category_name}
                </span>
                <span
                  className={`text-[10px] font-bold ${
                    c.status === "exceeded" ? "text-[var(--gnome-red-4)]" : "text-[var(--gnome-orange-4)]"
                  }`}
                >
                  {Math.round(c.percentage * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(!groups || groups.length === 0) && !flagged.length && (
        <div className="text-center py-12 text-[var(--text-secondary)] text-sm">
          <div className="text-3xl mb-2">📊</div>
          <p>No hay presupuestos configurados.</p>
        </div>
      )}
    </div>
  );
}
