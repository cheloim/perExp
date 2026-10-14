import { useQuery } from "@tanstack/react-query";
import { getBudgetGroups, getBudgetSummary } from "../../api/client";
import { formatCurrency } from "../../utils/format";
import SymbolicIcon from "../../components/SymbolicIcon";
import EmptyState from "../../components/ui/EmptyState";
import { getCategoryIcon } from "../../utils/categoryIcon";
import type { BudgetSummaryItem } from "../../types";

function MiniSpark({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-[3px] h-7 mt-2" aria-hidden="true">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${Math.max(8, (v / max) * 100)}%`,
            backgroundColor:
              i === values.length - 1
                ? "var(--color-warning)"
                : "color-mix(in srgb, var(--color-primary) 35%, transparent)",
          }}
        />
      ))}
    </div>
  );
}

function statusColor(status: string) {
  return status === "exceeded"
    ? "var(--color-danger)"
    : status === "warning"
      ? "var(--color-warning)"
      : status === "ok"
        ? "var(--color-success)"
        : "var(--text-tertiary)";
}

function statusLabel(status: string) {
  return status === "exceeded"
    ? "Excedido"
    : status === "warning"
      ? "Alerta"
      : status === "ok"
        ? "Bien"
        : "Sin presupuesto";
}

function CategoryRow({ cat }: { cat: BudgetSummaryItem }) {
  const icon = getCategoryIcon(cat.category_name);
  const pct = cat.budget_amount > 0 ? (cat.spent_amount / cat.budget_amount) * 100 : 0;
  const remaining = cat.budget_amount - cat.spent_amount;
  const limited = cat.months_with_data < 3;
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
            style={{ backgroundColor: `${cat.category_color}20` }}
          >
            {icon ? (
              <SymbolicIcon name={icon} size={14} />
            ) : (
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: cat.category_color }}
              />
            )}
          </span>
          <span className="text-xs font-medium text-[var(--text-primary)] truncate">
            {cat.category_name}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {limited && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full text-[var(--text-tertiary)] bg-[var(--color-base-alt)]">
              evidencia limitada
            </span>
          )}
          {cat.has_budget ? (
            <span
              className="text-[11px] font-semibold inline-flex items-center gap-1.5"
              style={{ color: statusColor(cat.status) }}
            >
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ backgroundColor: statusColor(cat.status) }}
              />
              {statusLabel(cat.status)}
            </span>
          ) : (
            <span className="text-[11px] text-[var(--text-tertiary)] italic">Sin presupuesto</span>
          )}
        </div>
      </div>
      <p className="text-[11px] text-[var(--text-secondary)] mb-1.5 ml-9">
        {cat.has_budget ? (
          <>
            {remaining >= 0 ? (
              <>
                {formatCurrency(remaining)} restantes de {formatCurrency(cat.budget_amount)}
              </>
            ) : (
              <span className="text-[var(--color-danger)]">
                {formatCurrency(Math.abs(remaining))} sobre {formatCurrency(cat.budget_amount)}
              </span>
            )}
          </>
        ) : (
          <>{formatCurrency(cat.spent_amount)} gastados</>
        )}
      </p>
      <div className="flex items-center gap-2 ml-9">
        <div className="flex-1 h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${cat.budget_amount > 0 ? Math.min(pct, 100) : cat.spent_amount > 0 ? 100 : 0}%`,
              backgroundColor:
                pct >= 100
                  ? "var(--color-danger)"
                  : pct >= 80
                    ? "var(--color-warning)"
                    : "var(--color-success)",
            }}
          />
        </div>
        <span className="text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
          <b className="text-[var(--text-primary)] font-semibold">
            {cat.has_budget ? `${Math.round(pct)}%` : formatCurrency(cat.spent_amount)}
          </b>
          {cat.avg_monthly > 0 && (
            <span className="text-[var(--text-tertiary)]">
              {" "}
              · prom {formatCurrency(cat.avg_monthly)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

export default function QuickBudget() {
  const { data: groups = [], isLoading: groupsLoading } = useQuery({
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
  const trendValues = (summary?.trend_6m ?? []).map((t) => t.total);

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dailyAvg = dayOfMonth > 0 ? totalSpent / dayOfMonth : 0;
  const budgetPace = daysInMonth > 0 ? totalBudget / daysInMonth : 0;
  const expectedToday = budgetPace * dayOfMonth;
  const paceRatio = expectedToday > 0 ? totalSpent / expectedToday : 0;
  const paceOk = budgetPace <= 0 || dailyAvg <= budgetPace * 1.1;

  const leaves = (summary?.categories ?? []).flatMap((c) => c.children);
  const visible = leaves.filter((c) => c.has_budget || c.spent_amount > 0);

  return (
    <div className="p-4 space-y-3">
      {/* Total KPI */}
      <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="adw-caption adw-dim-label">PRESUPUESTO DEL MES</span>
          <span className="text-xs font-bold text-[var(--text-primary)]">
            {totalPct}% utilizado
          </span>
        </div>
        <div className="h-3 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(totalPct, 100)}%`,
              backgroundColor:
                totalPct >= 100
                  ? "var(--color-danger)"
                  : totalPct >= 80
                    ? "var(--color-warning)"
                    : "var(--color-success)",
            }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[10px] text-[var(--text-secondary)]">
          <span>{formatCurrency(totalSpent)} gastado</span>
          <span>{formatCurrency(totalBudget)} total</span>
        </div>
        <MiniSpark values={trendValues} />
      </div>

      {/* Ritmo */}
      {totalBudget > 0 && (
        <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="adw-caption adw-dim-label">RITMO DIARIO</span>
            <span className={`text-xs font-bold ${paceOk ? "text-success" : "text-warning"}`}>
              {paceOk ? "dentro de banda" : "por encima del ritmo"}
            </span>
          </div>
          <p className="text-sm font-bold text-[var(--text-primary)] mt-1">
            {formatCurrency(dailyAvg)}
            <span className="adw-caption adw-dim-label font-normal">/día</span>
          </p>
          <div className="h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden mt-2">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(paceRatio * 100, 100)}%`,
                backgroundColor:
                  paceRatio <= 1
                    ? "var(--color-success)"
                    : paceRatio <= 1.1
                      ? "var(--color-warning)"
                      : "var(--color-danger)",
              }}
            />
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
            esperado a hoy {formatCurrency(expectedToday)}
          </p>
        </div>
      )}

      {/* Macro groups */}
      {groups && groups.length > 0 && (
        <div className="space-y-2">
          {groups.map((g) => {
            const pct = g.amount > 0 ? Math.round((g.spent / g.amount) * 100) : 0;
            const status = pct >= 100 ? "exceeded" : pct >= 80 ? "warning" : "ok";
            const barColor =
              status === "exceeded"
                ? "var(--color-danger)"
                : status === "warning"
                  ? "var(--color-warning)"
                  : "var(--color-success)";
            const iconName =
              g.name === "necesidades" ? "home" : g.name === "gustos" ? "gift" : "wallet";

            return (
              <div
                key={g.id}
                className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-3"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">
                      <SymbolicIcon name={iconName} size={16} />
                    </span>
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      {g.display_name}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold" style={{ color: barColor }}>
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

      {/* Categories */}
      {visible.length > 0 && (
        <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl px-3 py-1 divide-y divide-[var(--border-color)]">
          {visible.map((c) => (
            <CategoryRow key={c.category_id ?? c.category_name} cat={c} />
          ))}
        </div>
      )}

      {(!groups || groups.length === 0) && visible.length === 0 && (
        <EmptyState
          icon="chart-donut"
          title="Sin presupuestos"
          description="Configurá tus presupuestos desde la plataforma completa."
        />
      )}
    </div>
  );
}
