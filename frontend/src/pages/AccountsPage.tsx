import { useState, useRef, useCallback, useEffect, useMemo } from "react";
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
  deleteExpense,
  getExpenseStats,
  getCards,
  getAccounts,
} from "../api/client";
import type { Expense, ExpenseCreate } from "../types";
import { ExpenseModal } from "../components/ExpenseModals";
import {
  formatCurrency,
  toUpperCase,
  titleCase,
  getContrastTextColor,
  formatDateDMY,
} from "../utils/format";
import EmptyState from "../components/ui/EmptyState";

function TrendIcon({ current, previous }: { current: number; previous: number }) {
  if (!previous || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 5) return <span className="text-tertiary text-xs">→</span>;
  if (pct > 0) return <span className="text-red-500 text-xs font-bold">▲{pct.toFixed(2)}%</span>;
  return <span className="text-green-500 text-xs font-bold">▼{Math.abs(pct).toFixed(2)}%</span>;
}

type CardNetwork = "visa" | "mastercard" | "amex" | "unknown";

function detectNetwork(cardName: string): CardNetwork {
  const s = cardName.toLowerCase();
  if (s.includes("visa")) return "visa";
  if (s.includes("mastercard") || s.includes("master")) return "mastercard";
  if (s.includes("amex") || s.includes("american")) return "amex";
  return "unknown";
}

function VisaLogo() {
  return (
    <svg width="52" height="18" viewBox="0 0 52 18" fill="none">
      <text
        x="1"
        y="15"
        fontFamily="Arial Black, Arial, sans-serif"
        fontSize="17"
        fontWeight="900"
        fontStyle="italic"
        fill="white"
        letterSpacing="2"
      >
        VISA
      </text>
    </svg>
  );
}

function MastercardLogo() {
  return (
    <svg width="42" height="28" viewBox="0 0 42 28" fill="none">
      <circle cx="15" cy="14" r="13" fill="#EB001B" />
      <circle cx="27" cy="14" r="13" fill="#F79E1B" fillOpacity="0.92" />
    </svg>
  );
}

function AmexLogo() {
  return (
    <svg width="46" height="22" viewBox="0 0 46 22" fill="none">
      <rect width="46" height="22" rx="3" fill="rgba(255,255,255,0.25)" />
      <text
        x="23"
        y="15.5"
        textAnchor="middle"
        fontFamily="Arial, sans-serif"
        fontSize="10"
        fontWeight="bold"
        fill="white"
        letterSpacing="1.5"
      >
        AMEX
      </text>
    </svg>
  );
}

function CardNetworkLogo({ network }: { network: CardNetwork }) {
  if (network === "visa") return <VisaLogo />;
  if (network === "mastercard") return <MastercardLogo />;
  if (network === "amex") return <AmexLogo />;
  return null;
}

function CreditCardViz({
  cardName,
  holder,
  bank,
  monthly,
  active,
  onClick,
  index,
  filterMonth,
  showHolder,
}: {
  cardName: string;
  holder?: string;
  bank: string;
  monthly?: { month: string; total: number }[];
  active: boolean;
  onClick: () => void;
  index: number;
  filterMonth: string;
  showHolder?: boolean;
}) {
  const network = detectNetwork(cardName);
  const exactEntry = monthly?.find((m) => m.month === filterMonth);
  const monthTotal = exactEntry?.total ?? 0;
  const [dispY, dispM] = filterMonth.split("-");
  const monthLabel = `${MONTHS_ES[parseInt(dispM) - 1]} ${dispY}`;
  const gradientColors = [
    "from-gnomeBlue5 to-gnomeBlue4",
    "from-gnomeGreen5 to-gnomeGreen4",
    "from-gnomePurple5 to-gnomePurple4",
    "from-gnomeOrange5 to-gnomeOrange4",
    "from-gnomeDark2 to-gnomeDark3",
    "from-gnomeBlue4 to-gnomeBlue3",
  ];
  const color = gradientColors[index % gradientColors.length];
  const displayName = showHolder && holder ? `${holder.split(" ")[0]} — ${cardName}` : cardName;

  return (
    <div
      onClick={onClick}
      className={`relative rounded-2xl p-5 bg-gradient-to-br ${color} cursor-pointer transition-all duration-200 hover:scale-[1.01] shadow-xl flex-shrink-0 w-72 ${
        active ? "ring-2 ring-white/70 scale-[1.01]" : "opacity-90 hover:opacity-100"
      }`}
    >
      {/* Top row: left = bank + card type, right = logo */}
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <p className="text-white/60 text-[11px] font-semibold tracking-widest uppercase">
            {bank || "Banco"}
          </p>
          <p className="text-white text-sm font-bold tracking-wide mt-0.5 truncate">
            {displayName}
          </p>
        </div>
        <div className="flex-shrink-0">
          <CardNetworkLogo network={network} />
        </div>
      </div>

      {/* Month total */}
      <div className="mt-4 pt-3 border-t border-white/15 flex items-end justify-between">
        <div>
          <p className="text-white/50 text-[11px]">{monthLabel}</p>
          <p className="text-white font-bold text-xl leading-tight mt-0.5">
            {formatCurrency(monthTotal)}
          </p>
        </div>
        {/* Sparkline */}
        {monthly && monthly.length > 0 && (
          <div className="h-8 flex items-end gap-0.5 opacity-50 w-20">
            {(() => {
              const slice = monthly.slice(-6);
              const maxVal = Math.max(...slice.map((m) => Math.abs(m.total)), 1);
              return slice.map((m, i) => (
                <div
                  key={i}
                  className="flex-1 bg-surface/70 rounded-t-sm"
                  style={{ height: `${(Math.abs(m.total) / maxVal) * 100}%` }}
                />
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

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

function HScrollCards({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const scrollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [check]);

  const scrollBy = (dir: -1 | 1) => {
    ref.current?.scrollBy({ left: dir * 200, behavior: "smooth" });
  };

  const startScroll = (dir: -1 | 1) => {
    if (scrollInterval.current) return;
    scrollInterval.current = setInterval(() => {
      ref.current?.scrollBy({ left: dir * 6 });
    }, 16);
  };

  const stopScroll = () => {
    if (scrollInterval.current) {
      clearInterval(scrollInterval.current);
      scrollInterval.current = null;
    }
  };

  return (
    <div className="relative group/scroll">
      {/* Left arrow - Gnome HIG subtle circle button */}
      {canLeft && (
        <button
          onClick={() => scrollBy(-1)}
          onMouseEnter={() => startScroll(-1)}
          onMouseLeave={stopScroll}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full
                     bg-[var(--color-surface)] border border-[var(--border-color)] shadow-sm
                     flex items-center justify-center text-[var(--text-secondary)]
                     hover:text-[var(--text-primary)] hover:border-[var(--color-primary)]
                     hover:shadow-md transition-all duration-150 opacity-0 group-hover/scroll:opacity-100
                     text-sm font-medium"
        >
          ‹
        </button>
      )}
      {/* Right arrow - Gnome HIG subtle circle button */}
      {canRight && (
        <button
          onClick={() => scrollBy(1)}
          onMouseEnter={() => startScroll(1)}
          onMouseLeave={stopScroll}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full
                     bg-[var(--color-surface)] border border-[var(--border-color)] shadow-sm
                     flex items-center justify-center text-[var(--text-secondary)]
                     hover:text-[var(--text-primary)] hover:border-[var(--color-primary)]
                     hover:shadow-md transition-all duration-150 opacity-0 group-hover/scroll:opacity-100
                     text-sm font-medium"
        >
          ›
        </button>
      )}
      <div ref={ref} className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
        {children}
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(currentMonth);
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [bankFilter, setBankFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
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
  useQuery({ queryKey: ["accounts"], queryFn: getAccounts, staleTime: 300_000 });

  const activeCardEntry = activeCard
    ? cardData.find((c) => `${c.card_name}|${c.bank}|${c.holder}` === activeCard)
    : null;

  const activeCardKey = activeCardEntry?.card_name || null;
  const activeAccountId = activeCardEntry?.account_id || null;

  // Aggregated stats (lightweight)
  const { data: stats, isLoading: statsLoading } = useQuery({
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
    onError: (e: any) => setSaveError(e?.response?.data?.detail || e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ExpenseCreate> }) =>
      updateExpense(id, data),
    onSuccess: () => {
      invalidate();
      setEditing(undefined);
      setSaveError(null);
    },
    onError: (e: any) => setSaveError(e?.response?.data?.detail || e.message),
  });

  const evolutionChartData = useMemo(() => {
    const filtered = cardData
      .filter((card) => !bankFilter || card.bank === bankFilter)
      .filter((card) => {
        if (!typeFilter) return true;
        if (typeFilter === "efectivo") return card.card_type === "debito" && !card.bank;
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
    return date.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-primary">Cuentas</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={prevMonth}
              className="p-1.5 rounded-md hover:bg-[var(--color-base-alt)] text-[var(--text-secondary)] transition"
            >
              ←
            </button>
            <span className="text-sm font-medium text-[var(--text-primary)] min-w-[120px] text-center">
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
        {/* Cards panel — horizontal scroll row */}
        {cardData.length > 0 && (
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-primary">Resumen</h2>
              {/* Unified filters */}
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
                  { key: "efectivo", label: "Efectivo", color: "bg-gnomeOrange5" },
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
                          if (typeFilter === "efectivo") return c.card_type === "debito" && !c.bank;
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
            <HScrollCards>
              {(() => {
                const filtered = cardData
                  .filter((card) => !bankFilter || card.bank === bankFilter)
                  .filter((card) => {
                    if (!typeFilter) return true;
                    if (typeFilter === "efectivo") return card.card_type === "debito" && !card.bank;
                    return card.card_type === typeFilter;
                  });
                const holders = [...new Set(filtered.map((c) => c.holder).filter(Boolean))];
                const hasMultipleHolders = holders.length > 1;
                return filtered.map((card, idx) => {
                  const ckey = `${card.card_name}|${card.bank}|${card.holder}`;
                  return (
                    <div key={ckey}>
                      {hasMultipleHolders && card.holder && (
                        <p className="text-[10px] text-tertiary uppercase tracking-wide mb-1 px-1">
                          {card.holder}
                        </p>
                      )}
                      <CreditCardViz
                        index={idx}
                        cardName={card.card_name}
                        holder={card.holder}
                        bank={card.bank}
                        monthly={card.monthly}
                        active={activeCard === ckey}
                        showHolder={hasMultipleHolders}
                        onClick={() => setActiveCard(activeCard === ckey ? null : ckey)}
                        filterMonth={month}
                      />
                    </div>
                  );
                });
              })()}
            </HScrollCards>
          </div>
        )}

        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card p-5 space-y-4">
              <h2 className="text-base font-semibold text-primary">Gasto por Cuenta</h2>

              {cardData.length === 0 ? (
                <EmptyState
                  icon="📊"
                  title="Sin datos"
                  description="Los gastos por cuenta aparecerán aquí"
                />
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const sorted = [...cardData]
                      .filter((c) => !bankFilter || c.bank === bankFilter)
                      .filter((c) => {
                        if (!typeFilter) return true;
                        if (typeFilter === "efectivo") return c.card_type === "debito" && !c.bank;
                        return c.card_type === typeFilter;
                      })
                      .sort((a, b) => b.total_amount - a.total_amount);
                    const maxTotal = Math.max(...sorted.map((c) => c.total_amount), 1);
                    return sorted.map((card, idx) => {
                      const monthEntry = card.monthly?.find((m) => m.month === month);
                      const monthTotal = monthEntry?.total ?? 0;
                      const pct = maxTotal > 0 ? (monthTotal / maxTotal) * 100 : 0;
                      const ckey = `${card.card_name}|${card.bank}|${card.holder}`;
                      const isActive = activeCard === ckey;
                      const barColor = isActive
                        ? "bg-[var(--color-primary)]"
                        : card.card_type === "credito"
                        ? "bg-gnomeBlue5"
                        : card.card_type === "debito"
                        ? "bg-gnomeGreen5"
                        : "bg-gnomeOrange5";
                      return (
                        <button
                          key={ckey}
                          onClick={() => setActiveCard(activeCard === ckey ? null : ckey)}
                          className={`w-full text-left p-3 rounded-lg transition-all ${
                            isActive
                              ? "bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30"
                              : "hover:bg-[var(--color-base-alt)]"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                  card.card_type === "credito"
                                    ? "bg-gnomeBlue5"
                                    : card.card_type === "debito"
                                    ? "bg-gnomeGreen5"
                                    : "bg-gnomeOrange5"
                                }`}
                              />
                              <span className="text-sm font-medium text-primary truncate">
                                {card.bank || card.card_name}
                              </span>
                              <span className="text-xs text-tertiary">{card.card_name}</span>
                            </div>
                            <span className="text-sm font-semibold text-primary ml-2">
                              {formatCurrency(monthTotal)}
                            </span>
                          </div>
                          <div className="w-full h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                              style={{ width: `${Math.max(pct, 2)}%` }}
                            />
                          </div>
                        </button>
                      );
                    });
                  })()}
                </div>
              )}
            </div>

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
                      <LineChart
                        data={chartData}
                        margin={{ top: 4, right: 4, left: 0, bottom: 40 }}
                      >
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
                            new Intl.NumberFormat("es-AR", { notation: "compact" } as any).format(v)
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
      </div>
    </>
  );
}
