import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDashboard, getExpenses, getTagSummary } from "../../api/client";
import SymbolicIcon from "../../components/SymbolicIcon";
import { getCategoryEmoji } from "../../utils/categoryEmoji";
import { formatCurrency, toUpperCase } from "../../utils/format";
import { isDarkMode } from "../../services/telegramWebApp";

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

type KpiSelection = "gasto" | "comparativa";

export default function QuickSummary() {
  const [selectedKpi, setSelectedKpi] = useState<KpiSelection>("gasto");

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

  // Per-currency totals for the KPI
  const byCurrency = dash?.by_currency ?? [];
  const arsTotal = byCurrency.find((c) => c.currency === "ARS")?.total ?? 0;
  const usdTotal = byCurrency.find((c) => c.currency === "USD")?.total ?? 0;

  // Detect dark mode for text color
  const dark = isDarkMode();
  const amountColor = dark ? "#ffffff" : "#1c1b1f";

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
  // Red when spending increased (bad), green when decreased (good)
  const momColor = momPct > 0 ? "#e01b24" : momPct < 0 ? "#26a269" : "#71717a";

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

  const kpiBtn = (kpi: KpiSelection) =>
    `rounded-xl p-3 flex items-center gap-3 cursor-pointer active:scale-[0.97] transition-all ${
      selectedKpi === kpi
        ? "border-2 border-[var(--color-primary)] bg-[var(--color-primary)]/10"
        : "border border-[var(--border-color)]"
    }`;

  return (
    <div className="p-4 space-y-4">
      {/* Month header */}
      <div className="text-center">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          {monthLabel(currentMonth)}
        </h2>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={kpiBtn("gasto")} onClick={() => setSelectedKpi("gasto")}>
          <SymbolicIcon name="card" size={20} className="flex-shrink-0 opacity-60" />
          <div className="min-w-0">
            <div className="text-[10px] opacity-60">Gasto mes</div>
            <div className="text-base font-bold truncate" style={{ color: amountColor }}>
              {formatCurrency(arsTotal)}
            </div>
            {usdTotal > 0 && (
              <div className="text-[10px] opacity-60">+ {formatCurrency(usdTotal, "USD")}</div>
            )}
          </div>
        </button>
        <button
          type="button"
          className={kpiBtn("comparativa")}
          onClick={() => setSelectedKpi("comparativa")}
        >
          <SymbolicIcon
            name="chart-bar"
            size={20}
            className="text-[var(--text-tertiary)] flex-shrink-0"
          />
          <div className="min-w-0">
            <div className="text-[10px] text-[var(--text-secondary)]">vs mes anterior</div>
            <div className="text-base font-bold truncate" style={{ color: momColor }}>
              {momLabel}
            </div>
          </div>
        </button>
      </div>

      {/* Content based on selected KPI */}
      {selectedKpi === "comparativa" ? (
        /* Category comparison panel */
        catComparison.length > 0 && (
          <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-3">
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
                    <span className="text-[11px] text-[var(--text-primary)] font-medium flex-1 truncate">
                      {toUpperCase(cat.name)}
                    </span>
                    <span className="text-[11px] text-[var(--text-secondary)] text-right w-16">
                      {formatCurrency(cat.current)}
                    </span>
                    <span className="text-[10px] text-[var(--text-tertiary)] text-right w-14">
                      {cat.previous > 0 ? formatCurrency(cat.previous) : "—"}
                    </span>
                    <span
                      className="text-[11px] font-semibold text-right w-12"
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
          </div>
        )
      ) : (
        /* Gasto mes content: Top Categories + Top Cuentas + Transactions */
        <>
          {/* Top categories */}
          {topCats.length > 0 && (
            <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-4">
              <div className="text-[11px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-3">
                Top Categorías
              </div>
              <div className="space-y-2.5">
                {topCats.map((cat) => (
                  <div
                    key={cat.category_id ?? cat.category_name}
                    className="flex items-center gap-2"
                  >
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
              <div className="flex items-center gap-1.5 px-1">
                <SymbolicIcon name="list" size={14} className="text-[var(--color-primary)]" />
                <span className="text-[11px] font-semibold text-[var(--color-primary)] uppercase tracking-wider">
                  Transacciones de {monthLabel(currentMonth).split(" ")[0]}
                </span>
              </div>
              {expenses.map((exp) => (
                <div
                  key={exp.id}
                  className="flex items-center gap-2 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl px-3 py-2.5"
                >
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm"
                    style={{ backgroundColor: (exp.category_color || "#6b7280") + "20" }}
                  >
                    {getCategoryEmoji(exp.category_name) || (
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: exp.category_color || "#6b7280" }}
                      />
                    )}
                  </span>
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
        </>
      )}
    </div>
  );
}
