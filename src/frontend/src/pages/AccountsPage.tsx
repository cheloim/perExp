import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  getExpenses,
  getCardSummary,
  createExpense,
  updateExpense,
  getExpenseStats,
  getCards,
  getAccounts,
} from "../api/client";
import CardAccountModal from "../components/CardAccountModal";
import type { Expense, ExpenseCreate } from "../types";
import { ExpenseModal } from "../components/ExpenseModals";
import { formatCurrency, toUpperCase, getContrastTextColor, formatDateDMY } from "../utils/format";

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

export default function AccountsPage() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(currentMonth);
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [bankFilter, setBankFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [highlightedEntry, setHighlightedEntry] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Modal states
  const [editing, setEditing] = useState<Expense | null | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: cardData = [] } = useQuery({
    queryKey: ["card-summary"],
    queryFn: getCardSummary,
  });

  // Prefetch cards and accounts so modal opens instantly
  useQuery({ queryKey: ["cards"], queryFn: getCards, staleTime: 300_000 });
  useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
    staleTime: 300_000,
  });

  const activeCardEntry = activeCard
    ? cardData.find((c) => `${c.card_name}|${c.bank}|${c.holder}` === activeCard)
    : null;

  const activeCardKey = activeCardEntry?.card_name || null;
  const activeAccountId = activeCardEntry?.account_id || null;

  // Aggregated stats (lightweight)
  const { data: stats } = useQuery({
    queryKey: ["expense-stats", month, activeCardKey, activeAccountId],
    queryFn: () =>
      getExpenseStats({
        month: month || undefined,
        card: activeAccountId ? undefined : activeCardKey || undefined,
        account_id: activeAccountId || undefined,
      }),
    enabled: !!activeCard,
  });

  // Last 5 expenses for the selected account
  const { data: lastExpenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ["expenses", "last5", month, activeCardKey, activeAccountId],
    queryFn: () =>
      getExpenses({
        month: month || undefined,
        card: activeAccountId ? undefined : activeCardKey || undefined,
        limit: 5,
      }),
    enabled: !!activeCard,
  });

  // Mutations
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["expense-stats"] });
    queryClient.invalidateQueries({ queryKey: ["card-summary"] });
  };

  const createMut = useMutation({
    mutationFn: createExpense,
    onSuccess: () => {
      invalidate();
      setEditing(undefined);
      setSaveError(null);
    },
    onError: (e: { response?: { data?: { detail?: string } }; message?: string }) =>
      setSaveError(e?.response?.data?.detail || e.message || "Error al guardar"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ExpenseCreate> }) =>
      updateExpense(id, data),
    onSuccess: () => {
      invalidate();
      setEditing(undefined);
      setSaveError(null);
    },
    onError: (e: { response?: { data?: { detail?: string } }; message?: string }) =>
      setSaveError(e?.response?.data?.detail || e.message || "Error al guardar"),
  });

  const evolutionChartData = useMemo(() => {
    const filtered = cardData
      .filter((card) => !bankFilter || card.bank === bankFilter)
      .filter((card) => {
        if (!typeFilter) return true;
        if (typeFilter === "cuentas") return card.card_type === "debito" && !card.bank;
        return card.card_type === typeFilter;
      });

    const [selYear, selMonth] = month.split("-");
    const selMonthNum = parseInt(selMonth);
    const monthsRange: string[] = [];
    for (let i = -5; i <= 0; i++) {
      const d = new Date(parseInt(selYear), selMonthNum - 1 + i, 1);
      monthsRange.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const chartData = monthsRange.map((m) => {
      const entry: Record<string, number | string> = { month: m };
      let monthTotal = 0;
      filtered.forEach((card) => {
        const cardKey = card.holder ? `${card.holder}|${card.card_name}` : card.card_name;
        const monthData = card.monthly?.find((x: { month: string }) => x.month === m);
        const value = monthData?.total || 0;
        entry[cardKey] = value;
        monthTotal += value;
      });
      entry["total"] = monthTotal;
      return entry;
    });

    return { filtered, chartData, monthsRange };
  }, [cardData, bankFilter, month, typeFilter]);

  // Filtered data for Resumen (same filters as evolution chart)
  const filteredData = useMemo(() => {
    return cardData
      .filter((card) => !bankFilter || card.bank === bankFilter)
      .filter((card) => {
        if (!typeFilter) return true;
        if (typeFilter === "cuentas") return card.card_type === "debito" && !card.bank;
        return card.card_type === typeFilter;
      });
  }, [cardData, bankFilter, typeFilter]);

  // Summary data calculation
  const summaryData = useMemo(() => {
    const [year, monthNum] = month.split("-").map(Number);
    const prevMonthKey =
      monthNum === 1 ? `${year - 1}-12` : `${year}-${String(monthNum - 1).padStart(2, "0")}`;
    const prevMonthName = new Date(year, monthNum - 2).toLocaleDateString("es-AR", {
      month: "long",
    });

    let totalThis = 0;
    let totalPrev = 0;
    let totalCount = 0;
    let biggestChange = { key: "", diff: 0 };

    for (const card of filteredData) {
      const thisMonth = card.monthly?.find((m) => m.month === month)?.total ?? 0;
      const prevMonth = card.monthly?.find((m) => m.month === prevMonthKey)?.total ?? 0;
      totalThis += thisMonth;
      totalPrev += prevMonth;
      totalCount += card.count;

      const diff = thisMonth - prevMonth;
      if (Math.abs(diff) > Math.abs(biggestChange.diff)) {
        biggestChange = {
          key: `${card.card_name}|${card.bank}|${card.holder}`,
          diff,
        };
      }
    }

    const diffPct = totalPrev > 0 ? Math.round(((totalThis - totalPrev) / totalPrev) * 100) : 0;

    return {
      totalThis,
      diffPct,
      totalCount,
      prevMonthName: prevMonthName.charAt(0).toUpperCase() + prevMonthName.slice(1),
      biggestChange,
    };
  }, [filteredData, month]);

  // Group entries by type
  const groups = useMemo(
    () => ({
      credito: filteredData.filter((c) => c.card_type === "credito"),
      debito: filteredData.filter(
        (c) => c.card_type === "debito" && (c.bank || c.linked_account_name),
      ),
      cuentas: filteredData.filter(
        (c) => c.card_type === "debito" && !c.bank && !c.linked_account_name,
      ),
    }),
    [filteredData],
  );

  // Toggle group collapse
  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(group) ? next.delete(group) : next.add(group);
      return next;
    });
  };

  // Handle summary card click
  const handleSummaryClick = (type: "total" | "vs" | "txns") => {
    if (type === "vs" && summaryData.biggestChange.key) {
      setHighlightedEntry(summaryData.biggestChange.key);
      setActiveCard(summaryData.biggestChange.key);
      setTimeout(() => setHighlightedEntry(null), 2000);
    }
    document.getElementById("resumen-list")?.scrollIntoView({ behavior: "smooth" });
  };

  const prevMonth = () => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const nextMonth = () => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const formatMonthLabel = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    const date = new Date(y, mo - 1);
    const label = date.toLocaleDateString("es-AR", { month: "long" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  return (
    <>
      <div className="space-y-6">
        <div className="space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold text-primary">Cuentas</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowCreateModal(true)}
              className="gnome-btn-primary-round text-sm"
            >
              + Crear
            </button>
            <div className="flex items-center gap-1 ml-auto sm:ml-0">
              <button
                onClick={prevMonth}
                className="p-1.5 rounded-md hover:bg-[var(--color-base-alt)] text-[var(--text-secondary)] transition"
              >
                ←
              </button>
              <span className="text-sm font-medium text-[var(--text-primary)] min-w-[70px] text-center">
                {formatMonthLabel(month)}
              </span>
              <button
                onClick={nextMonth}
                className="p-1.5 rounded-md hover:bg-[var(--color-base-alt)] text-[var(--text-secondary)] transition"
              >
                →
              </button>
            </div>
          </div>
        </div>
        {/* Resumen — new design */}
        {cardData.length > 0 && (
          <div className="card p-4 space-y-4" id="resumen-list">
            {/* Section title */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-primary">
                Resumen de {formatMonthLabel(month)}
              </h2>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => {
                    setTypeFilter(null);
                    setBankFilter(null);
                  }}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                    !typeFilter && !bankFilter
                      ? "bg-primary text-on-primary border-primary"
                      : "border-border-color text-tertiary hover:text-primary"
                  }`}
                >
                  Todos
                </button>
                {[
                  { key: "credito", label: "Crédito", color: "bg-gnomeBlue5" },
                  { key: "debito", label: "Débito", color: "bg-gnomeGreen5" },
                  {
                    key: "cuentas",
                    label: "Cuentas",
                    color: "bg-gnomeOrange5",
                  },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTypeFilter(typeFilter === t.key ? null : t.key)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all flex items-center gap-1 ${
                      typeFilter === t.key
                        ? "bg-primary text-on-primary border-primary"
                        : "border-border-color text-tertiary hover:text-primary"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${t.color}`} />
                    {t.label}
                  </button>
                ))}
                {(() => {
                  const filteredBanks = [
                    ...new Set(
                      cardData
                        .filter((c) => {
                          if (!typeFilter) return true;
                          if (typeFilter === "cuentas") return c.card_type === "debito" && !c.bank;
                          return c.card_type === typeFilter;
                        })
                        .map((c) => c.bank)
                        .filter(Boolean),
                    ),
                  ].sort();
                  if (filteredBanks.length <= 1) return null;
                  return filteredBanks.map((b) => (
                    <button
                      key={b}
                      onClick={() => setBankFilter(bankFilter === b ? null : b)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                        bankFilter === b
                          ? "bg-primary text-on-primary border-primary"
                          : "border-border-color text-tertiary hover:text-primary"
                      }`}
                    >
                      {b}
                    </button>
                  ));
                })()}
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => handleSummaryClick("total")}
                className="card p-3 text-center border border-transparent hover:border-[var(--color-primary)] transition-colors"
              >
                <p className="text-[10px] text-tertiary uppercase tracking-wider">Total</p>
                <p className="text-lg font-bold text-primary mt-0.5">
                  {formatCurrency(summaryData.totalThis)}
                </p>
              </button>

              <button
                onClick={() => handleSummaryClick("vs")}
                className="card p-3 text-center border border-transparent hover:border-[var(--color-primary)] transition-colors"
              >
                <p className="text-[10px] text-tertiary uppercase tracking-wider">
                  vs {summaryData.prevMonthName}
                </p>
                <p
                  className={`text-lg font-bold mt-0.5 ${
                    summaryData.diffPct >= 0
                      ? "text-[var(--gnome-red-3)]"
                      : "text-[var(--gnome-green-5)]"
                  }`}
                >
                  {summaryData.diffPct >= 0 ? "↑" : "↓"} {Math.abs(summaryData.diffPct)}%
                </p>
              </button>

              <button
                onClick={() => handleSummaryClick("txns")}
                className="card p-3 text-center border border-transparent hover:border-[var(--color-primary)] transition-colors"
              >
                <p className="text-[10px] text-tertiary uppercase tracking-wider">Transacciones</p>
                <p className="text-lg font-bold text-primary mt-0.5">{summaryData.totalCount}</p>
              </button>
            </div>

            {/* Grouped entries */}
            {(() => {
              // Calculate total across ALL entries for percentage
              const allTotal = filteredData.reduce((sum, c) => {
                const entry = c.monthly?.find((m) => m.month === month);
                return sum + (entry?.total ?? 0);
              }, 0);

              return [
                {
                  key: "credito",
                  label: "Crédito",
                  items: groups.credito,
                  dotColor: "bg-gnomeBlue5",
                  barColor: "bg-[var(--gnome-blue-3)]",
                  hoverBorder: "hover:border-[var(--gnome-blue-2)]",
                  activeBorder: "border-[var(--gnome-blue-3)]",
                  textColor: "text-[var(--gnome-blue-5)]",
                },
                {
                  key: "debito",
                  label: "Débito",
                  items: groups.debito,
                  dotColor: "bg-gnomeGreen5",
                  barColor: "bg-[var(--gnome-green-3)]",
                  hoverBorder: "hover:border-[var(--gnome-green-2)]",
                  activeBorder: "border-[var(--gnome-green-3)]",
                  textColor: "text-[var(--gnome-green-5)]",
                },
                {
                  key: "cuentas",
                  label: "Cuentas",
                  items: groups.cuentas,
                  dotColor: "bg-gnomeOrange5",
                  barColor: "bg-[var(--gnome-orange-3)]",
                  hoverBorder: "hover:border-[var(--gnome-orange-2)]",
                  activeBorder: "border-[var(--gnome-orange-3)]",
                  textColor: "text-[var(--gnome-orange-5)]",
                },
              ]
                .filter((g) => g.items.length > 0)
                .map((group) => {
                  const isCollapsed = collapsedGroups.has(group.key);

                  return (
                    <div key={group.key}>
                      {/* Group header */}
                      <button
                        onClick={() => toggleGroup(group.key)}
                        className="flex items-center gap-2 w-full mt-2 mb-2 group"
                      >
                        <span className={`w-2 h-2 rounded-full ${group.dotColor}`} />
                        <span
                          className={`text-xs font-semibold uppercase tracking-wider ${group.textColor}`}
                        >
                          {group.label}
                        </span>
                        <span className="text-[10px] text-tertiary">({group.items.length})</span>
                        <div className="flex-1 h-px bg-border-color" />
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className={`text-[var(--text-tertiary)] transition-transform duration-200 ${
                            isCollapsed ? "" : "rotate-180"
                          }`}
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>

                      {/* Group entries */}
                      <div
                        className="overflow-hidden transition-all duration-300 ease-in-out"
                        style={{
                          maxHeight: isCollapsed ? "0px" : `${group.items.length * 120}px`,
                        }}
                      >
                        <div className="space-y-2 pb-2">
                          {group.items.map((card) => {
                            const monthEntry = card.monthly?.find((m) => m.month === month);
                            const monthTotal = monthEntry?.total ?? 0;
                            const pctOfTotal = allTotal > 0 ? (monthTotal / allTotal) * 100 : 0;
                            const ckey = `${card.card_name}|${card.bank}|${card.holder}`;
                            const isActive = activeCard === ckey;
                            const isHighlighted = highlightedEntry === ckey;
                            const icon =
                              card.card_name.toLowerCase().includes("mercadopago") ||
                              card.card_name.toLowerCase().includes("mp")
                                ? "📱"
                                : !card.bank && !card.linked_account_name
                                  ? "💵"
                                  : "💳";

                            return (
                              <button
                                key={ckey}
                                onClick={() => setActiveCard(activeCard === ckey ? null : ckey)}
                                className={`w-full text-left p-3 rounded-lg border transition-all duration-300 ${
                                  isActive
                                    ? `${group.activeBorder} bg-[var(--color-base-alt)]`
                                    : isHighlighted
                                      ? `${group.activeBorder} bg-[var(--color-base-alt)]`
                                      : `border-transparent ${group.hoverBorder} hover:bg-[var(--color-base-alt)]`
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-sm">{icon}</span>
                                    <span className="text-sm font-semibold text-primary truncate">
                                      {card.card_name}
                                      {card.bank ? ` | ${card.bank}` : ""}
                                    </span>
                                    {card.linked_account_name && (
                                      <span className="text-[11px] text-[var(--gnome-green-5)] whitespace-nowrap">
                                        ↳ {card.linked_account_name}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-sm font-bold text-primary whitespace-nowrap">
                                    {formatCurrency(monthTotal)}
                                  </span>
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                  <div className="flex-1 h-1.5 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ${group.barColor}`}
                                      style={{
                                        width: `${Math.max(pctOfTotal, 2)}%`,
                                      }}
                                    />
                                  </div>
                                  <span className="text-[11px] text-tertiary whitespace-nowrap w-10 text-right">
                                    {Math.round(pctOfTotal)}%
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                });
            })()}
          </div>
        )}

        <div className="space-y-6">
          {/* Evolución por Cuenta */}
          <div className="card p-5">
            <h2 className="text-base font-semibold text-primary mb-4">Evolución por Cuenta</h2>
            {(() => {
              const { filtered: filteredCards, chartData, monthsRange } = evolutionChartData;

              const colors = [
                "#6366f1",
                "#10b981",
                "#f59e0b",
                "#ef4444",
                "#8b5cf6",
                "#06b6d4",
                "#ec4899",
                "#84cc16",
              ];

              return (
                <div className="bg-base-alt rounded-lg p-4">
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 40 }}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--chart-grid)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 10, fill: "var(--chart-text)" }}
                        tickFormatter={(v) => {
                          const [y, m] = v.split("-");
                          return `${MONTHS_ES[parseInt(m) - 1].slice(0, 3)} ${y.slice(2)}`;
                        }}
                      />
                      <YAxis
                        tickFormatter={(v) =>
                          new Intl.NumberFormat("es-AR", {
                            notation: "compact",
                          } as Intl.NumberFormatOptions).format(v)
                        }
                        tick={{ fontSize: 11, fill: "var(--chart-text)" }}
                        width={50}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--chart-tooltip-bg)",
                          borderColor: "var(--chart-tooltip-border)",
                          color: "var(--chart-tooltip-text)",
                        }}
                        itemStyle={{ color: "var(--chart-tooltip-text)" }}
                        formatter={(v: number, name: string) => [formatCurrency(v), name]}
                        labelFormatter={(label) => {
                          const [y, m] = label.split("-");
                          const currentData = chartData.find(
                            (d: Record<string, number | string>) => d.month === label,
                          );
                          const currentTotal =
                            typeof currentData?.total === "number" ? currentData.total : 0;
                          const currentIdx = monthsRange.indexOf(label);
                          const prevMonth = currentIdx > 0 ? chartData[currentIdx - 1] : null;
                          let tooltip = `${MONTHS_ES[parseInt(m) - 1]} ${y}`;
                          if (prevMonth && typeof prevMonth.total === "number") {
                            const diff = currentTotal - prevMonth.total;
                            const pct =
                              prevMonth.total > 0
                                ? ((diff / prevMonth.total) * 100).toFixed(2)
                                : "0.00";
                            const diffSign = diff >= 0 ? "+" : "";
                            tooltip += `\nvs mes anterior: ${diffSign}${formatCurrency(
                              diff,
                            )} (${diffSign}${pct}%)`;
                          }
                          return tooltip;
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="total"
                        name="Total"
                        stroke="var(--chart-text)"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={{ r: 4, fill: "var(--chart-text)" }}
                        opacity={0.4}
                      />
                      {filteredCards.map((card, idx) => {
                        const cardKey = card.holder
                          ? `${card.holder}|${card.card_name}`
                          : card.card_name;
                        const displayName = card.holder
                          ? `${card.holder} — ${card.card_name}`
                          : card.card_name;
                        return (
                          <Line
                            key={cardKey}
                            type="monotone"
                            dataKey={cardKey}
                            name={displayName}
                            stroke={colors[idx % colors.length]}
                            strokeWidth={2}
                            dot={{ r: 3, fill: colors[idx % colors.length] }}
                            connectNulls
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}
          </div>

          {/* Account Detail Summary */}
          {activeCard && stats && (
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-primary">
                  {cardData.find((c) => `${c.card_name}|${c.bank}|${c.holder}` === activeCard)
                    ?.bank || "Cuenta"}
                  {cardData.find((c) => `${c.card_name}|${c.bank}|${c.holder}` === activeCard)
                    ?.holder && (
                    <span className="text-sm font-normal text-tertiary ml-2">
                      —{" "}
                      {
                        cardData
                          .find((c) => `${c.card_name}|${c.bank}|${c.holder}` === activeCard)
                          ?.holder.split(" ")[0]
                      }
                    </span>
                  )}
                </h2>
                <button
                  onClick={() => setActiveCard(null)}
                  className="text-xs text-tertiary hover:text-primary"
                >
                  Cerrar
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-[var(--color-base-alt)] rounded-lg">
                  <p className="text-[10px] text-tertiary uppercase">Total</p>
                  <p className="text-lg font-bold text-primary">{formatCurrency(stats.total)}</p>
                </div>
                <div className="p-3 bg-[var(--color-base-alt)] rounded-lg">
                  <p className="text-[10px] text-tertiary uppercase">Transacciones</p>
                  <p className="text-lg font-bold text-primary">{stats.count}</p>
                </div>
                <div className="p-3 bg-[var(--color-base-alt)] rounded-lg">
                  <p className="text-[10px] text-tertiary uppercase">Promedio</p>
                  <p className="text-lg font-bold text-primary">{formatCurrency(stats.avg)}</p>
                </div>
                <div className="p-3 bg-[var(--color-base-alt)] rounded-lg">
                  <p className="text-[10px] text-tertiary uppercase">Último uso</p>
                  <p className="text-sm font-bold text-primary">
                    {stats.last_used ? formatDateDMY(stats.last_used) : "—"}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-secondary mb-2">Últimos gastos</h3>
                {expensesLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div
                        key={i}
                        className="h-10 bg-[var(--color-base-alt)] rounded animate-pulse"
                      />
                    ))}
                  </div>
                ) : lastExpenses.length === 0 ? (
                  <p className="text-xs text-tertiary">Sin gastos en este período</p>
                ) : (
                  <div className="divide-y divide-[var(--border-color)]">
                    {lastExpenses.map((exp) => (
                      <div
                        key={exp.id}
                        className="flex items-center justify-between py-2.5 hover:bg-[var(--color-base-alt)] rounded px-2 -mx-2 cursor-pointer transition-colors"
                        onClick={() => setEditing(exp)}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-primary truncate">
                            {toUpperCase(exp.description)}
                          </p>
                          <div className="flex items-center gap-1.5 text-xs text-tertiary">
                            <span>{formatDateDMY(exp.date)}</span>
                            {exp.category_name && (
                              <>
                                <span>·</span>
                                <span
                                  className="px-1.5 py-0.5 rounded-full text-[10px]"
                                  style={{
                                    backgroundColor: `${exp.category_color || "#9a9996"}20`,
                                    color: getContrastTextColor(exp.category_color || "#9a9996"),
                                  }}
                                >
                                  {exp.category_name}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-primary ml-3">
                          {formatCurrency(Math.abs(exp.amount), exp.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Unified Modal Rendering */}
        {editing !== undefined && (
          <ExpenseModal
            initial={editing === undefined ? null : editing}
            onClose={() => {
              setEditing(undefined);
              setSaveError(null);
            }}
            onSave={(data) => {
              if (editing) {
                updateMut.mutate({ id: editing.id, data });
              } else {
                createMut.mutate(data);
              }
            }}
            saveError={saveError}
            isSaving={createMut.isPending || updateMut.isPending}
          />
        )}

        {showCreateModal && <CardAccountModal onClose={() => setShowCreateModal(false)} />}
      </div>
    </>
  );
}
