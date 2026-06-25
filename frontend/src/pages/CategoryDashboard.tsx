import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { getDashboard, getCategoryTrend, getTopMerchants } from "../api/client";
import type { TopMerchant } from "../types";
import { formatCurrency, MonthSelector, toUpperCase } from "../utils/format";
import CategoryTreemap from "../components/CategoryTreemap";
import { useFamilyGroup } from "../context/FamilyGroupContext";

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const UNCATEGORIZED = "Sin categoría";

interface TrendRow {
  month: string;
  [key: string]: number | string;
}

export default function CategoryDashboard() {
  const navigate = useNavigate();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(currentMonth);
  const [selectedCategoryName, setSelectedCategoryName] = useState<string | null>(null);
  const [trendMonths, setTrendMonths] = useState(6);
  const [merchantTab, setMerchantTab] = useState<"amount" | "count">("amount");
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const { members } = useFamilyGroup();

  const trendRangeLabel = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const end = new Date(y, m - 1, 1);
    const start = new Date(y, m - 1 - (trendMonths - 1), 1);
    const fmt = (d: Date) => `${MONTH_NAMES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
    return `${fmt(start)} – ${fmt(end)}`;
  }, [month, trendMonths]);

  const { data: summary, isLoading, isError: summaryError } = useQuery({
    queryKey: ["dashboard", "cat-dash", month, personFilter],
    queryFn: () => getDashboard({ month, person: personFilter ?? undefined }),
    placeholderData: (prev) => prev,
  });

  const { data: trendData, isLoading: trendLoading, isError: trendError } = useQuery({
    queryKey: ["category-trend", month, trendMonths, personFilter],
    queryFn: () => getCategoryTrend(trendMonths, month, personFilter ?? undefined),
    staleTime: 60_000,
  });

  const { data: merchantsRaw = [], isLoading: merchantsLoading, isError: merchantsError } = useQuery({
    queryKey: ["top-merchants", month, personFilter],
    queryFn: () => getTopMerchants({ month, limit: 20, person: personFilter ?? undefined }),
    staleTime: 60_000,
  });

  const categories = summary?.by_category ?? [];
  const grandTotal = useMemo(() => categories.reduce((s, c) => s + c.total, 0), [categories]);

  const activeCat = selectedCategoryName
    ? (categories.find((c) => c.category_name === selectedCategoryName) ?? null)
    : null;

  const activeGroup = useMemo(() => {
    if (!selectedCategoryName || activeCat) return null;
    const children = categories.filter((c) => c.parent_name === selectedCategoryName);
    if (children.length === 0) return null;
    // Also include parent's own ID if it has a direct category entry
    const parentEntry = categories.find((c) => c.category_name === selectedCategoryName);
    const allIds = [
      ...(parentEntry?.category_id != null ? [parentEntry.category_id] : []),
      ...children.map((c) => c.category_id).filter((id): id is number => id != null),
    ];
    return {
      name: selectedCategoryName,
      color: children[0].parent_color ?? parentEntry?.category_color ?? "#6b7280",
      total: (parentEntry?.total ?? 0) + children.reduce((s, c) => s + c.total, 0),
      count: (parentEntry?.count ?? 0) + children.reduce((s, c) => s + c.count, 0),
      previous_total: (parentEntry?.previous_total ?? 0) + children.reduce((s, c) => s + (c.previous_total ?? 0), 0),
      childIds: allIds,
    };
  }, [selectedCategoryName, categories, activeCat]);

  const activeSelection = useMemo(() => {
    if (activeCat) {
      return {
        name: activeCat.category_name,
        color: activeCat.category_color,
        total: activeCat.total,
        count: activeCat.count,
        previous_total: activeCat.previous_total ?? 0,
        childIds: activeCat.category_id != null ? [activeCat.category_id] : [],
      };
    }
    return activeGroup;
  }, [activeCat, activeGroup]);

  const displayTotal = activeSelection ? activeSelection.total : (summary?.total_amount ?? 0);
  const displayCount = activeSelection ? activeSelection.count : (summary?.total_expenses ?? 0);
  const displayAvg = displayCount > 0 ? displayTotal / displayCount : 0;

  const previousTotal = useMemo(
    () =>
      activeSelection
        ? (activeSelection.previous_total ?? 0)
        : (summary?.by_category?.reduce((s, c) => s + (c.previous_total ?? 0), 0) ?? 0),
    [activeSelection, summary],
  );
  const pctChange = previousTotal > 0 ? ((displayTotal - previousTotal) / previousTotal) * 100 : null;

  const visibleCategories = trendData?.categories ?? [];

  const filteredMerchants = useMemo(() => {
    if (!activeSelection) return merchantsRaw;
    return merchantsRaw.filter((m) => {
      if (activeSelection.name === UNCATEGORIZED) {
        return m.category_name === null || m.category_name === UNCATEGORIZED;
      }
      // Direct category match
      const directMatch = m.category_name === activeSelection.name;
      if (directMatch) return true;
      // Parent category match — check if merchant belongs to a child
      const childNames = categories
        .filter((c) => c.parent_name === activeSelection.name)
        .map((c) => c.category_name);
      return childNames.length > 0 && childNames.includes(m.category_name ?? "");
    });
  }, [merchantsRaw, activeSelection, categories]);

  const sortedMerchants = useMemo(
    () =>
      [...filteredMerchants]
        .sort((a, b) =>
          merchantTab === "amount" ? b.total_amount - a.total_amount : b.count - a.count,
        )
        .slice(0, 10),
    [filteredMerchants, merchantTab],
  );

  const maxMerchantVal = useMemo(
    () =>
      sortedMerchants.length > 0
        ? Math.max(
            ...sortedMerchants.map((m) => (merchantTab === "amount" ? m.total_amount : m.count)),
          )
        : 1,
    [sortedMerchants, merchantTab],
  );

  const { chartData, topTrendCategories } = useMemo(() => {
    if (!trendData) return { chartData: [], topTrendCategories: [] };
    const cats = trendData.categories;
    const rows = trendData.rows as TrendRow[];

    if (cats.length <= 6) {
      return { chartData: rows, topTrendCategories: cats };
    }

    const totals = cats.map((c) => ({
      ...c,
      total: rows.reduce((s, r) => s + ((r[c.name] as number) || 0), 0),
    }));
    totals.sort((a, b) => b.total - a.total);
    const top5 = totals.slice(0, 5);
    const topNames = new Set(top5.map((c) => c.name));

    const otrosByMonth: Record<string, number> = {};
    for (const row of rows) {
      let otrosTotal = 0;
      for (const key of Object.keys(row)) {
        if (key === "month") continue;
        if (!topNames.has(key)) otrosTotal += ((row[key] as number) || 0);
      }
      otrosByMonth[row.month] = otrosTotal;
    }

    const enrichedRows = rows.map((row) => ({
      ...row,
      Otros: otrosByMonth[row.month] || 0,
    }));

    const otherLine = {
      name: "Otros",
      color: "#94a3b8",
      total: Object.values(otrosByMonth).reduce((s, v) => s + v, 0),
    };
    return { chartData: enrichedRows, topTrendCategories: [...top5, otherLine] };
  }, [trendData]);

  const handleCategorySelect = (name: string | null) => {
    setSelectedCategoryName((prev) => (prev === name ? null : name));
  };

  const goToExpenses = () => {
    if (activeCat) {
      if (activeCat.category_id != null) {
        navigate(`/expenses?category_id=${activeCat.category_id}&month=${month}`);
      } else {
        navigate(`/expenses?uncategorized=1&month=${month}`);
      }
    } else if (activeGroup) {
      if (activeGroup.childIds.length > 0) {
        navigate(`/expenses?category_ids=${activeGroup.childIds.join(",")}&month=${month}`);
      } else {
        navigate(`/expenses?uncategorized=1&month=${month}`);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-1">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
            Por Categoría
          </h1>
          {activeSelection && (
            <span className="text-sm text-[var(--text-tertiary)]">/ {activeSelection.name}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <MonthSelector
            value={month}
            onChange={(v) => {
              setMonth(v);
              setSelectedCategoryName(null);
              setPersonFilter(null);
            }}
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div
          className="card p-4 transition-all duration-200"
          style={activeSelection ? { borderTopColor: activeSelection.color, borderTopWidth: "2px" } : undefined}
        >
          <p className="text-xs font-medium text-[var(--text-primary)] mb-1">
            {activeSelection ? activeSelection.name : "Total"}
          </p>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-[var(--text-primary)]">{formatCurrency(displayTotal)}</p>
            {pctChange !== null && (
              <span className={`text-xs font-medium ${pctChange >= 0 ? "text-danger" : "text-success"}`}>
                {pctChange >= 0 ? "↑" : "↓"} {Math.abs(pctChange).toFixed(0)}%
              </span>
            )}
          </div>
        </div>
        <div
          className="card p-4 transition-all duration-200"
          style={activeSelection ? { borderTopColor: activeSelection.color, borderTopWidth: "2px" } : undefined}
        >
          <p className="text-xs font-medium text-[var(--text-primary)] mb-1">Transacciones</p>
          <p className="text-2xl font-bold text-[var(--text-primary)]">{displayCount}</p>
        </div>
        <div
          className="card p-4 transition-all duration-200"
          style={activeSelection ? { borderTopColor: activeSelection.color, borderTopWidth: "2px" } : undefined}
        >
          <p className="text-xs font-medium text-[var(--text-primary)] mb-1">Promedio</p>
          <p className="text-2xl font-bold text-[var(--text-primary)]">{formatCurrency(displayAvg)}</p>
        </div>
      </div>

      {/* Person filter chips */}
      {members.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap px-1">
          <span className="text-xs text-[var(--text-secondary)]">Persona:</span>
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => setPersonFilter(personFilter === m.name ? null : m.name)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                personFilter === m.name
                  ? "bg-[var(--color-primary)] text-[var(--color-on-primary)] border-[var(--color-primary)]"
                  : "bg-transparent text-[var(--text-secondary)] border-[var(--border-color)] hover:bg-[var(--color-base-alt)]"
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}

      {/* Two-column: Treemap + Trend chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Treemap */}
        <div className="card p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-primary">Gastos por categoría</h2>
            {selectedCategoryName && (
              <button
                onClick={() => setSelectedCategoryName(null)}
                className="text-xs px-2.5 py-1 rounded-full border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition"
              >
                Limpiar selección
              </button>
            )}
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-base-alt)]" />
                  <div className="h-3 w-24 rounded bg-[var(--color-base-alt)]" />
                  <div className="flex-1 h-2 rounded-full bg-[var(--color-base-alt)]" />
                  <div className="h-3 w-16 rounded bg-[var(--color-base-alt)]" />
                </div>
              ))}
            </div>
          ) : summaryError ? (
            <p className="text-danger text-sm text-center py-10">Error al cargar datos</p>
          ) : (
            <div className="flex-1 min-h-[300px]">
              <CategoryTreemap
                categories={categories}
                selectedCategoryName={selectedCategoryName}
                onSelect={handleCategorySelect}
              />
            </div>
          )}
          {activeSelection ? (
            <div
              className="mt-3 p-3 rounded-lg bg-[var(--color-base-alt)] border-l-2"
              style={{ borderLeftColor: activeSelection.color }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeSelection.color }} />
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{activeSelection.name}</span>
                </div>
                <button
                  onClick={goToExpenses}
                  className="text-xs px-3 py-1 rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-110 active:scale-95 transition-all font-medium"
                >
                  Ver gastos →
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-[var(--text-primary)] font-semibold text-base">{formatCurrency(activeSelection.total)}</div>
                <div className="text-[var(--text-secondary)]">{activeSelection.count} transacciones</div>
                {grandTotal > 0 && <div className="text-[var(--text-secondary)]">{((activeSelection.total / grandTotal) * 100).toFixed(1)}% del total</div>}
                {activeSelection.previous_total != null && activeSelection.previous_total > 0 ? (
                  <div className={activeSelection.total > activeSelection.previous_total ? "text-danger" : "text-success"}>
                    {activeSelection.total > activeSelection.previous_total ? "↑" : "↓"}{" "}
                    {Math.abs(((activeSelection.total - activeSelection.previous_total) / activeSelection.previous_total) * 100).toFixed(0)}% vs mes anterior
                  </div>
                ) : activeSelection.previous_total === 0 ? (
                  <div className="text-[var(--text-tertiary)]">Nuevo este mes</div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-secondary)] mt-3 text-center">
              Hacé clic en una categoría para ver detalles
            </p>
          )}
        </div>

        {/* Trend chart + Top Comercios */}
        <div className="flex flex-col gap-6">
          <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-primary">
              Tendencia — {trendRangeLabel}
            </h2>
            <div className="flex items-center gap-1">
              {[3, 6, 12].map((n) => (
                <button
                  key={n}
                  onClick={() => setTrendMonths(n)}
                  aria-label={`${n} meses`}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                    trendMonths === n
                      ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                      : "bg-[var(--color-base-alt)] text-[var(--text-secondary)] hover:brightness-95"
                  }`}
                >
                  {n}m
                </button>
              ))}
            </div>
          </div>
          {trendLoading ? (
            <div className="space-y-3 py-4">
              <div className="h-4 w-full rounded bg-[var(--color-base-alt)]" />
              <div className="h-[240px] rounded bg-[var(--color-base-alt)]" />
              <div className="flex gap-4 justify-center">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-3 w-16 rounded bg-[var(--color-base-alt)]" />
                ))}
              </div>
            </div>
          ) : trendError ? (
            <p className="text-danger text-sm text-center py-12">Error al cargar tendencia</p>
          ) : visibleCategories.length === 0 ? (
            <p className="text-[var(--text-secondary)] text-sm text-center py-12">Sin datos</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <defs>
                  {topTrendCategories.map((cat) => {
                    const gradId = `grad-${cat.name.replace(/[^a-zA-Z0-9]/g, "-")}`;
                    return (
                      <linearGradient key={gradId} id={gradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={cat.color || "var(--chart-text)"} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={cat.color || "var(--chart-text)"} stopOpacity={0} />
                      </linearGradient>
                    );
                  })}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "var(--chart-text)" }}
                  tickFormatter={(v: string) => {
                    const [y, m] = String(v).split("-");
                    return `${MONTH_NAMES[parseInt(m) - 1]} ${y.slice(2)}`;
                  }}
                />
                <YAxis
                  tickFormatter={(v) =>
                    new Intl.NumberFormat("es-AR", { notation: "compact" }).format(v)
                  }
                  tick={{ fontSize: 11, fill: "var(--chart-text)" }}
                  width={52}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--chart-tooltip-bg)",
                    borderColor: "var(--chart-tooltip-border)",
                    color: "var(--chart-tooltip-text)",
                  }}
                  itemStyle={{ color: "var(--chart-tooltip-text)" }}
                  formatter={(v: number, name: string) => [formatCurrency(v), name]}
                  labelFormatter={(l: string) => {
                    const [y, m] = l.split("-");
                    return `${MONTH_NAMES[parseInt(m) - 1]} ${y}`;
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                  iconType="circle"
                  iconSize={8}
                  onClick={(e) => handleCategorySelect(e.value as string)}
                  formatter={(value: string) => (
                    <span
                      className={`cursor-pointer text-xs ${
                        selectedCategoryName && selectedCategoryName !== value
                          ? "opacity-40"
                          : "text-[var(--text-secondary)]"
                      }`}
                    >
                      {value}
                    </span>
                  )}
                />
                {topTrendCategories.map((cat) => {
                  const gradId = `grad-${cat.name.replace(/[^a-zA-Z0-9]/g, "-")}`;
                  return (
                    <Area
                      key={cat.name}
                      type="monotone"
                      dataKey={cat.name}
                      stroke={cat.color || "var(--chart-text)"}
                      fill={`url(#${gradId})`}
                    strokeWidth={selectedCategoryName === cat.name ? 3 : 2}
                    strokeOpacity={
                      selectedCategoryName && selectedCategoryName !== cat.name ? 0.2 : 1
                    }
                    fillOpacity={
                      selectedCategoryName && selectedCategoryName !== cat.name ? 0.05 : 1
                    }
                    dot={{ r: 3, fill: cat.color || "var(--chart-text)" }}
                    activeDot={{ r: 5, onClick: () => handleCategorySelect(cat.name) }}
                    connectNulls
                    />
                  );
                })}
              </AreaChart>
            </ResponsiveContainer>
          )}
          </div>

          {/* Top Comercios */}
          <div className="card p-5 flex-1">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-primary">
                Top Comercios
                {activeSelection && (
                  <span className="ml-2 text-xs text-[var(--text-secondary)]">— {activeSelection.name}</span>
                )}
              </h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMerchantTab("amount")}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                    merchantTab === "amount"
                      ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                      : "bg-[var(--color-base-alt)] text-[var(--text-secondary)] hover:brightness-95"
                  }`}
                >
                  Por monto
                </button>
                <button
                  onClick={() => setMerchantTab("count")}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                    merchantTab === "count"
                      ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                      : "bg-[var(--color-base-alt)] text-[var(--text-secondary)] hover:brightness-95"
                  }`}
                >
                  Por frecuencia
                </button>
              </div>
            </div>

            {merchantsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-[var(--color-base-alt)]" />
                    <div className="h-3 w-32 rounded bg-[var(--color-base-alt)]" />
                    <div className="flex-1 h-2 rounded-full bg-[var(--color-base-alt)]" />
                    <div className="h-3 w-16 rounded bg-[var(--color-base-alt)]" />
                  </div>
                ))}
              </div>
            ) : merchantsError ? (
              <p className="text-danger text-sm text-center py-8">Error al cargar comercios</p>
            ) : sortedMerchants.length === 0 ? (
              <p className="text-[var(--text-secondary)] text-sm text-center py-8">Sin datos</p>
            ) : (
              <div className="space-y-3">
                {sortedMerchants.map((m, i) => {
                  const val = merchantTab === "amount" ? m.total_amount : m.count;
                  const pct = maxMerchantVal > 0 ? (val / maxMerchantVal) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-3 group/merchant">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: m.category_color || "var(--color-primary)" }}
                      />
                      <button
                        onClick={() => navigate(`/expenses?search=${encodeURIComponent(m.description)}&month=${month}`)}
                        className="text-xs text-[var(--text-secondary)] min-w-0 truncate flex-shrink-0 max-w-[180px] text-left hover:text-[var(--text-primary)] transition-colors"
                        title={`Ver gastos de ${m.description}`}
                      >
                        {toUpperCase(m.description)}
                      </button>
                      <div className="flex-1 h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: m.category_color || "var(--color-primary)",
                          }}
                        />
                      </div>
                      <span className="text-xs text-[var(--text-tertiary)] flex-shrink-0 w-24 text-right">
                        {merchantTab === "amount"
                          ? formatCurrency(m.total_amount)
                          : `${m.count}×`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
