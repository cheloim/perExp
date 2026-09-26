import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDashboard, getExpenses, getTagSummary } from "../../api/client";
import { formatCurrency, toUpperCase } from "../../utils/format";

const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

const MONTHS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS_ES[parseInt(m, 10) - 1]} ${y}`;
}

export default function QuickSummary() {
  const [showComparison, setShowComparison] = useState(false);

  const { data: dash, isLoading } = useQuery({
    queryKey: ["dashboard", "quick", currentMonth],
    queryFn: () => getDashboard({ month: currentMonth }),
  });

  const { data: cuentaData = [] } = useQuery({
    queryKey: ["tag-summary", "cuenta", currentMonth],
    queryFn: () => getTagSummary("cuenta"),
    staleTime: 60_000,
  });

  const { data: monthExpenses = [] } = useQuery({
    queryKey: ["expenses", "quick", currentMonth],
    queryFn: () => getExpenses({ month: currentMonth, limit: 20 }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--text-secondary)] text-sm">
        Cargando...
      </div>
    );
  }

  const totalExpenses = dash?.total_expenses ?? 0;

  // Per-currency totals for the KPI
  const byCurrency = dash?.by_currency ?? [];
  const arsTotal = byCurrency.find((c) => c.currency === "ARS")?.total ?? 0;
  const usdTotal = byCurrency.find((c) => c.currency === "USD")?.total ?? 0;

  // MoM comparison (only ARS for consistency with platform)
  const categories = dash?.by_category ?? [];
  const prevTotal = categories.reduce((s, c) => s + (c.previous_total ?? 0), 0);
  const momPct = prevTotal > 0 ? ((arsTotal - prevTotal) / prevTotal) * 100 : 0;
  const momLabel =
    Math.abs(momPct) < 1
      ? "≈ igual"
      : momPct > 0
        ? `↑ ${Math.abs(Math.round(momPct))}%`
        : `↓ ${Math.abs(Math.round(momPct))}%`;
  const momColor =
    momPct > 0
      ? "var(--gnome-red-5)"
      : momPct < 0
        ? "var(--gnome-green-5)"
        : "var(--text-secondary)";
  const momBg =
    momPct > 0
      ? "var(--gnome-red-1)"
      : momPct < 0
        ? "var(--gnome-green-1)"
        : "var(--color-base-alt)";

  // Category comparison data (current vs previous)
  const catComparison = categories
    .filter((c) => (c.total ?? 0) > 0 || (c.previous_total ?? 0) > 0)
    .map((c) => {
      const cur = c.total ?? 0;
      const prev = c.previous_total ?? 0;
      const changePct = prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;
      return {
        id: c.category_id ?? c.category_name,
        name: c.category_name,
        color: c.category_color || "#6b7280",
        current: cur,
        previous: prev,
        changePct,
      };
    })
    .sort((a, b) => b.current - a.current);

  // Top categories — total is mixed currency (same as platform web)
  const topCats = [...categories].sort((a, b) => b.total - a.total).slice(0, 5);
  const catMax = topCats[0]?.total ?? 1;

  // Month-filtered expenses
  const expenses = monthExpenses.filter((e) => !e.is_income);

  return (
    <div className="p-4 space-y-4">
      {/* Month header */}
      <div className="text-center">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          {monthLabel(currentMonth)}
        </h2>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-4 text-center bg-[var(--color-base-alt)]">
          <div className="text-[11px] text-[var(--text-secondary)] mb-1">Gasto mes</div>
          <div className="text-xl font-bold text-[var(--text-primary)]">
            {formatCurrency(arsTotal)}
          </div>
          {usdTotal > 0 && (
            <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
              + {formatCurrency(usdTotal, "USD")}
            </div>
          )}
        </div>
        <button
          type="button"
          className="rounded-xl p-4 text-center cursor-pointer active:scale-[0.97] transition-transform"
          style={{ backgroundColor: momBg }}
          onClick={() => setShowComparison((v) => !v)}
        >
          <div className="text-[11px] text-[var(--text-secondary)] mb-1">vs mes anterior</div>
          <div className="text-xl font-bold" style={{ color: momColor }}>
            {momLabel}
          </div>
          <div className="text-[9px] text-[var(--text-tertiary)] mt-0.5">
            {showComparison ? "tocar para cerrar" : "tocar para detalle"}
          </div>
        </button>
        <div className="rounded-xl p-4 text-center bg-[var(--color-primary)]/10">
          <div className="text-[11px] text-[var(--text-secondary)] mb-1">Transacciones</div>
          <div className="text-xl font-bold text-[var(--color-primary)]">{totalExpenses}</div>
        </div>
      </div>

      {/* Category comparison panel (expandable) */}
      {showComparison && catComparison.length > 0 && (
        <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-3">
            Comparativa por categoría
          </div>
          <div className="space-y-2">
            {catComparison.map((cat) => {
              const isUp = cat.changePct > 0;
              const isNeutral = Math.abs(cat.changePct) < 1;
              const arrowColor = isUp
                ? "var(--gnome-red-5)"
                : isNeutral
                  ? "var(--text-tertiary)"
                  : "var(--gnome-green-5)";

              return (
                <div key={cat.id} className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="text-[11px] text-[var(--text-primary)] font-medium w-20 truncate">
                    {toUpperCase(cat.name)}
                  </span>
                  <span className="text-[11px] text-[var(--text-secondary)] text-right flex-1">
                    {formatCurrency(cat.current)}
                  </span>
                  <span className="text-[10px] text-[var(--text-tertiary)] w-14 text-right">
                    {cat.previous > 0 ? formatCurrency(cat.previous) : "—"}
                  </span>
                  <span
                    className="text-[11px] font-semibold w-12 text-right"
                    style={{ color: arrowColor }}
                  >
                    {isNeutral
                      ? "≈"
                      : isUp
                        ? `↑${Math.abs(Math.round(cat.changePct))}%`
                        : `↓${Math.abs(Math.round(cat.changePct))}%`}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-3 pt-2 border-t border-[var(--border-color)]">
            <div className="text-[9px] text-[var(--text-tertiary)] flex-1">Categoría</div>
            <div className="text-[9px] text-[var(--text-tertiary)] w-20 text-right">Este mes</div>
            <div className="text-[9px] text-[var(--text-tertiary)] w-14 text-right">Anterior</div>
            <div className="text-[9px] text-[var(--text-tertiary)] w-12 text-right">Var.</div>
          </div>
        </div>
      )}

      {/* Top categories */}
      {topCats.length > 0 && (
        <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-4">
          <div className="text-[11px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-3">
            Top Categorías
          </div>
          <div className="space-y-2.5">
            {topCats.map((cat) => (
              <div key={cat.category_id ?? cat.category_name} className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: cat.category_color || "#6b7280" }}
                />
                <span className="text-xs text-[var(--text-primary)] font-medium w-16 truncate">
                  {toUpperCase(cat.category_name)}
                </span>
                <div className="flex-1 h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(cat.total / catMax) * 100}%`,
                      backgroundColor: cat.category_color || "var(--color-primary)",
                    }}
                  />
                </div>
                <span className="text-xs text-[var(--text-secondary)] font-semibold whitespace-nowrap">
                  {formatCurrency(cat.total)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Cuentas */}
      {(() => {
        const topCuentas = cuentaData
          .map((t) => {
            const monthEntry = t.monthly?.find((m) => m.month === currentMonth);
            return { ...t, current_amount: monthEntry?.total ?? 0 };
          })
          .filter((t) => t.current_amount > 0)
          .sort((a, b) => b.current_amount - a.current_amount)
          .slice(0, 3);
        return topCuentas.length > 0 ? (
          <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-4">
            <div className="text-[11px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-3">
              Top Cuentas
            </div>
            <div className="space-y-2.5">
              {topCuentas.map((t) => (
                <div key={t.tag_id ?? "null"} className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: t.tag_color }}
                  />
                  <span className="text-xs text-[var(--text-primary)] font-medium flex-1 truncate">
                    {t.tag_name}
                  </span>
                  <span className="text-xs text-[var(--text-secondary)] font-semibold whitespace-nowrap">
                    {formatCurrency(t.current_amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null;
      })()}

      {/* Month transactions */}
      {expenses.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-[var(--color-primary)] uppercase tracking-wider px-1">
            Transacciones de {monthLabel(currentMonth).split(" ")[0]}
          </div>
          {expenses.map((exp) => (
            <div
              key={exp.id}
              className="flex items-center gap-2 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl px-3 py-2.5"
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: exp.category_color || "#6b7280" }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                  {exp.description}
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)]">
                  {toUpperCase(exp.category_name ?? "Sin cat.")}
                </div>
              </div>
              <span className="text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap">
                {formatCurrency(exp.amount, exp.currency)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
