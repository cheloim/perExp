import { useQuery } from "@tanstack/react-query";
import { getDashboard, getTagSummary } from "../../api/client";
import { formatCurrency, toUpperCase } from "../../utils/format";

const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

export default function QuickSummary() {
  const { data: dash, isLoading } = useQuery({
    queryKey: ["dashboard", "quick", currentMonth],
    queryFn: () => getDashboard({ month: currentMonth }),
  });

  const { data: cuentaData = [] } = useQuery({
    queryKey: ["tag-summary", "cuenta", currentMonth],
    queryFn: () => getTagSummary("cuenta"),
    staleTime: 60_000,
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
  const prevTotal = (dash?.by_category ?? []).reduce((s, c) => s + (c.previous_total ?? 0), 0);
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

  // Top categories — total is mixed currency (same as platform web)
  const topCats = [...(dash?.by_category ?? [])].sort((a, b) => b.total - a.total).slice(0, 5);
  const catMax = topCats[0]?.total ?? 1;

  // Recent expenses
  const recent = (dash?.recent_expenses ?? []).slice(0, 5);

  return (
    <div className="p-4 space-y-3">
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl p-3 text-center bg-[var(--color-base-alt)]">
          <div className="text-[10px] text-[var(--text-secondary)]">Gasto mes</div>
          <div className="text-lg font-bold text-[var(--text-primary)]">
            {formatCurrency(arsTotal)}
          </div>
          {usdTotal > 0 && (
            <div className="text-[10px] text-[var(--text-tertiary)]">
              + {formatCurrency(usdTotal, "USD")}
            </div>
          )}
        </div>
        <div className="rounded-xl p-3 text-center" style={{ backgroundColor: momBg }}>
          <div className="text-[10px] text-[var(--text-secondary)]">vs mes anterior</div>
          <div className="text-lg font-bold" style={{ color: momColor }}>
            {momLabel}
          </div>
        </div>
        <div className="rounded-xl p-3 text-center bg-[var(--color-primary)]/10">
          <div className="text-[10px] text-[var(--text-secondary)]">Transacciones</div>
          <div className="text-lg font-bold text-[var(--color-primary)]">{totalExpenses}</div>
        </div>
      </div>

      {/* Top categories */}
      {topCats.length > 0 && (
        <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-3">
          <div className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-2">
            Top Categorías
          </div>
          <div className="space-y-2">
            {topCats.map((cat) => (
              <div key={cat.category_id ?? cat.category_name} className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: cat.category_color || "#6b7280" }}
                />
                <span className="text-xs text-[var(--text-primary)] font-medium w-16 truncate">
                  {toUpperCase(cat.category_name)}
                </span>
                <div className="flex-1 h-1.5 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
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
          <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-3">
            <div className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-2">
              Top Cuentas
            </div>
            <div className="space-y-2">
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

      {/* Recent expenses */}
      {recent.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider px-1">
            Últimos gastos
          </div>
          {recent.map((exp) => (
            <div
              key={exp.id}
              className="flex items-center gap-2 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl px-3 py-2"
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
