import { useQuery } from "@tanstack/react-query";
import { getDashboard } from "../../api/client";
import { formatCurrency, toUpperCase } from "../../utils/format";

const CATEGORY_EMOJI: Record<string, string> = {
  alimentación: "🛒",
  supermercado: "🛒",
  transporte: "🚗",
  uber: "🚗",
  salud: "💊",
  farmacia: "💊",
  servicios: "💡",
  entretenimiento: "🎬",
  streaming: "🎬",
  suscripciones: "📲",
  educación: "📚",
  ropa: "👕",
  hogar: "🏠",
  tecnología: "💻",
  deporte: "🏋️",
  viajes: "✈️",
  mascotas: "🐾",
  impuestos: "🧾",
  banco: "🏦",
};

function getEmoji(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(CATEGORY_EMOJI)) {
    if (lower.includes(key)) return emoji;
  }
  return "📂";
}

export default function QuickSummary() {
  const { data: dash, isLoading } = useQuery({
    queryKey: ["dashboard", "quick-summary"],
    queryFn: () => getDashboard(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--text-secondary)] text-sm">
        Cargando...
      </div>
    );
  }

  const totalSpent = dash?.total_amount ?? 0;
  const totalExpenses = dash?.total_expenses ?? 0;

  // MoM comparison
  const prevTotal = (dash?.by_category ?? []).reduce(
    (s, c) => s + (c.previous_total ?? 0),
    0,
  );
  const momPct = prevTotal > 0 ? ((totalSpent - prevTotal) / prevTotal) * 100 : 0;
  const momLabel =
    Math.abs(momPct) < 1
      ? "≈ igual"
      : momPct > 0
        ? `↑ ${Math.abs(Math.round(momPct))}%`
        : `↓ ${Math.abs(Math.round(momPct))}%`;
  const momColor =
    momPct > 0 ? "var(--gnome-red-5)" : momPct < 0 ? "var(--gnome-green-5)" : "var(--text-secondary)";
  const momBg =
    momPct > 0 ? "var(--gnome-red-1)" : momPct < 0 ? "var(--gnome-green-1)" : "var(--color-base-alt)";

  // Top categories (non-income only, by category_name)
  const topCats = [...(dash?.by_category ?? [])]
    .filter((c) => {
      // Filter out income categories by name heuristic
      const name = c.category_name.toLowerCase();
      return !name.includes("ingreso") && !name.includes("salary") && !name.includes("sueldo");
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
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
            {formatCurrency(totalSpent)}
          </div>
          <div className="text-[10px] text-[var(--text-tertiary)]">
            {totalExpenses} transacciones
          </div>
        </div>
        <div
          className="rounded-xl p-3 text-center"
          style={{ backgroundColor: momBg }}
        >
          <div className="text-[10px] text-[var(--text-secondary)]">vs mes anterior</div>
          <div className="text-lg font-bold" style={{ color: momColor }}>
            {momLabel}
          </div>
        </div>
        <div className="rounded-xl p-3 text-center bg-[var(--color-primary)]/10">
          <div className="text-[10px] text-[var(--text-secondary)]">Ingresos</div>
          <div className="text-lg font-bold text-[var(--color-primary)]">
            {formatCurrency(
              (dash?.by_category ?? [])
                .filter((c) => {
                  const name = c.category_name.toLowerCase();
                  return name.includes("ingreso") || name.includes("salary") || name.includes("sueldo");
                })
                .reduce((s, c) => s + c.total, 0),
            )}
          </div>
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
                <span className="text-sm">{getEmoji(cat.category_name)}</span>
                <span className="text-xs text-[var(--text-primary)] font-medium w-16 truncate">
                  {toUpperCase(cat.category_name)}
                </span>
                <div className="flex-1 h-1.5 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--color-primary)]"
                    style={{ width: `${(cat.total / catMax) * 100}%` }}
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
              <span className="w-7 h-7 rounded-full bg-[var(--color-base-alt)] flex items-center justify-center text-xs flex-shrink-0">
                {getEmoji(exp.category_name ?? "")}
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
    </div>
  );
}
