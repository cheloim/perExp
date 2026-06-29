import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis } from "recharts";
import {
  getDashboard,
  getCardSummary,
  getExpenses,
  getScheduledSummary,
  getInvestments,
  getMyGroup,
  createExpense,
  getUsdRate,
  getCreditCardPasivos,
  getInstallmentsMonthlyLoad,
  getTopMerchants,
} from "../api/client";
import type { Expense, ExpenseCreate } from "../types";
import { formatCurrency, toUpperCase, formatDateDMYSlash, MONTHS_ES_SHORT } from "../utils/format";
import { ExpenseModal } from "../components/ExpenseModals";
import EmptyState from "../components/ui/EmptyState";

const FALLBACK_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#eab308", // yellow
  "#f97316", // orange
  "#a855f7", // purple
  "#ef4444", // red
  "#06b6d4", // cyan
];

function CardRow({
  cardName,
  bank,
  total,
  cardType,
  holder,
}: {
  cardName: string;
  bank: string;
  total: number;
  cardType?: string;
  holder?: string;
}) {
  const isAccount =
    !bank ||
    cardName.toLowerCase().includes("efectivo") ||
    cardName.toLowerCase().includes("cuenta");

  const renderIcon = () => {
    if (isAccount) {
      if (cardName.toLowerCase().includes("efectivo")) return "💵";
      if (cardName.toLowerCase().includes("mercadopago") || cardName.toLowerCase().includes("mp"))
        return "📱";
      return "🏦";
    }
    return "💳";
  };

  const getNetwork = (name: string): string => {
    const n = name.toLowerCase();
    if (n.includes("visa")) return "Visa";
    if (n.includes("mastercard") || n.includes("master card")) return "Mastercard";
    if (n.includes("amex") || n.includes("american express")) return "Amex";
    return name.split(" ")[0];
  };

  const network = getNetwork(cardName);
  const displayName = cardType === "debito" ? "Débito" : network;

  return (
    <div className="flex items-center justify-between py-2.5 px-1">
      <div className="flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-lg ${
            isAccount ? "bg-success/10" : "bg-base-alt"
          } flex items-center justify-center text-xs`}
        >
          {renderIcon()}
        </div>
        <div>
          <p className="text-sm font-medium text-primary leading-tight">
            {displayName}
            {bank ? ` | ${bank}` : ""}
          </p>
          {holder && <p className="text-xs text-tertiary leading-tight">{holder}</p>}
        </div>
      </div>
      <span className="text-sm font-semibold text-primary">{formatCurrency(total)}</span>
    </div>
  );
}

export default function Dashboard() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = currentMonth;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Expense | null | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const createMut = useMutation({
    mutationFn: (data: ExpenseCreate) => createExpense(data),
    onSuccess: () => {
      setEditing(undefined);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["card-summary"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-month"] });
    },
  });

  const handleSave = (data: ExpenseCreate) => {
    setSaveError(null);
    createMut.mutate(data);
  };

  const { data: dashData } = useQuery({
    queryKey: ["dashboard", month],
    queryFn: () => getDashboard({ month }),
    placeholderData: (prev) => prev,
  });

  const { data: cardData = [] } = useQuery({
    queryKey: ["card-summary"],
    queryFn: getCardSummary,
    staleTime: 60_000,
  });

  // Expenses for current month
  const { data: monthExpenses = [] } = useQuery({
    queryKey: ["expenses-month", month],
    queryFn: () =>
      getExpenses({
        month,
        limit: 500,
      }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  // Scheduled expenses for current month
  const { data: scheduledData } = useQuery({
    queryKey: ["scheduled-summary"],
    queryFn: () => getScheduledSummary(),
    staleTime: 60_000,
  });

  const { data: myGroup } = useQuery({
    queryKey: ["my-group"],
    queryFn: getMyGroup,
    staleTime: 300_000,
  });

  // Investments
  const { data: investments = [] } = useQuery({
    queryKey: ["investments"],
    queryFn: () => getInvestments(),
    staleTime: 60_000,
  });

  // USD exchange rate for conversion
  const { data: usdRate } = useQuery({
    queryKey: ["usd-rate"],
    queryFn: getUsdRate,
    staleTime: 30 * 60_000,
  });

  // Credit card pasivos (pending debt)
  const { data: pasivosData } = useQuery({
    queryKey: ["credit-card-pasivos"],
    queryFn: getCreditCardPasivos,
    staleTime: 60_000,
  });

  // Installment monthly load (7 months)
  const { data: monthlyLoad = [] } = useQuery({
    queryKey: ["installments-monthly-load"],
    queryFn: getInstallmentsMonthlyLoad,
    staleTime: 60_000,
  });

  // Top merchants for current month
  const { data: topMerchants = [] } = useQuery({
    queryKey: ["top-merchants", month],
    queryFn: () => getTopMerchants({ month, limit: 5 }),
    staleTime: 60_000,
  });

  // Calculate savings by currency
  const savingsArs = useMemo(
    () =>
      investments
        .filter((i) => i.currency === "ARS")
        .reduce((sum, i) => sum + i.quantity * (i.current_price ?? i.avg_cost ?? 0), 0),
    [investments],
  );

  // USD total: native USD investments + ARS investments converted to USD
  const totalUsd = useMemo(() => {
    const nativeUsd = investments
      .filter((i) => i.currency === "USD")
      .reduce((sum, i) => sum + i.quantity * (i.current_price ?? i.avg_cost ?? 0), 0);

    if (!usdRate?.rate) return nativeUsd;

    const arsTotal = investments
      .filter((i) => i.currency === "ARS")
      .reduce((sum, i) => sum + i.quantity * (i.current_price ?? i.avg_cost ?? 0), 0);

    return nativeUsd + arsTotal / usdRate.rate;
  }, [investments, usdRate]);

  // All categories sorted by spending (top 7 + Otros)
  const categories = useMemo(() => {
    const allCats = [...(dashData?.by_category ?? [])]
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total);

    if (allCats.length <= 7) return allCats;

    const top7 = allCats.slice(0, 7);
    const othersTotal = allCats.slice(7).reduce((sum, c) => sum + c.total, 0);

    if (othersTotal > 0) {
      const othersPreviousTotal = allCats
        .slice(7)
        .reduce((sum, c) => sum + (c.previous_total ?? 0), 0);
      return [
        ...top7,
        {
          category_name: "Otros",
          category_color: "#94a3b8",
          total: othersTotal,
          previous_total: othersPreviousTotal,
          category_id: null,
        },
      ];
    }
    return top7;
  }, [dashData?.by_category]);

  const maxCatTotal = categories[0]?.total ?? 1;

  const handleCategorySelect = (name: string) => {
    setSelectedCategory(selectedCategory === name ? null : name);
  };

  // Filtered expenses by selected category (frontend filtering)
  const filteredExpenses = useMemo(() => {
    if (!selectedCategory) return monthExpenses;

    // "Otros (N)" = categories with category_id null or small slices
    if (selectedCategory.startsWith("Otros")) {
      const bigCategoryNames = new Set(categories.map((c) => c.category_name));
      return monthExpenses.filter(
        (exp) => !exp.category_id || !bigCategoryNames.has(exp.category_name ?? ""),
      );
    }

    // Normal category — filter by category_name
    return monthExpenses.filter((exp) => exp.category_name === selectedCategory);
  }, [monthExpenses, selectedCategory, categories]);

  // Pie chart data — group small slices into "Otros"
  const pieData = useMemo(() => {
    const categories = dashData?.by_category ?? [];
    const total = categories.reduce((s, c) => s + Math.abs(c.total), 0);
    const big: typeof categories = [];
    const small: typeof categories = [];
    for (const c of categories) {
      if (c.total <= 0) continue;
      const pct = total > 0 ? (c.total / total) * 100 : 0;
      if (pct >= 3) big.push(c);
      else small.push(c);
    }
    const result = big.map((c) => ({
      name: c.category_name,
      color: c.category_color || FALLBACK_COLORS[big.indexOf(c) % FALLBACK_COLORS.length],
      total: c.total,
    }));
    if (small.length > 0) {
      result.push({
        name: `Otros (${small.length})`,
        color: "#94a3b8",
        total: small.reduce((s, c) => s + c.total, 0),
      });
    }
    return result;
  }, [dashData?.by_category]);

  // KPI calculations
  const totalSpent = dashData?.total_amount ?? 0;
  const totalPasivos = pasivosData?.total_pasivos ?? 0;
  const currentMonthLoad = monthlyLoad.find((m) => m.is_current);
  const cuotasComprometidas = currentMonthLoad?.total ?? 0;

  // MoM comparison: total this month vs total of all previous_total in categories
  const prevMonthTotal = (dashData?.by_category ?? []).reduce(
    (s, c) => s + (c.previous_total ?? 0),
    0,
  );
  const momVariation =
    prevMonthTotal > 0 ? ((totalSpent - prevMonthTotal) / prevMonthTotal) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-primary">NikoFin</h1>
          {myGroup && myGroup.members.length > 1 && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              Grupo familiar
            </span>
          )}
        </div>
        <button onClick={() => setEditing(null)} className="gnome-btn-primary-round text-sm">
          <span className="text-base leading-none">+</span>
          <span>Nuevo gasto</span>
        </button>
      </div>

      {/* KPI Row */}
      <div
        className={`grid grid-cols-2 ${
          savingsArs > 0 || totalUsd > 0 ? "md:grid-cols-5" : "md:grid-cols-4"
        } gap-4`}
      >
        <div className="card p-4">
          <p className="text-[10px] text-tertiary uppercase mb-1">Total gastado</p>
          <p className="text-lg font-bold text-primary">{formatCurrency(totalSpent)}</p>
          <p className="text-xs text-tertiary mt-1">
            {dashData?.total_expenses ?? 0} transacciones
          </p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] text-tertiary uppercase mb-1">Deuda tarjetas</p>
          <p className="text-lg font-bold text-danger">{formatCurrency(totalPasivos)}</p>
          <p className="text-xs text-tertiary mt-1">{pasivosData?.count ?? 0} cuotas pendientes</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] text-tertiary uppercase mb-1">Cuotas este mes</p>
          <p className="text-lg font-bold text-primary">{formatCurrency(cuotasComprometidas)}</p>
          <p className="text-xs text-tertiary mt-1">{currentMonthLoad?.count ?? 0} cuotas</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] text-tertiary uppercase mb-1">vs Mes anterior</p>
          <p
            className={`text-lg font-bold ${
              momVariation > 0 ? "text-danger" : momVariation < 0 ? "text-success" : "text-tertiary"
            }`}
          >
            {momVariation > 0 ? "↑" : momVariation < 0 ? "↓" : "→"}{" "}
            {Math.abs(momVariation).toFixed(1)}%
          </p>
          <p className="text-xs text-tertiary mt-1">
            {momVariation > 0 ? "Gastaste más" : momVariation < 0 ? "Gastaste menos" : "Sin cambio"}
          </p>
        </div>
        {(savingsArs > 0 || totalUsd > 0) && (
          <div
            className="card p-4 cursor-pointer hover:bg-[var(--color-base-alt)] transition-colors"
            onClick={() => navigate("/investments")}
          >
            <p className="text-[10px] text-tertiary uppercase mb-1">Inversiones</p>
            <div className="space-y-0.5">
              <p className="text-sm font-bold text-primary">
                {savingsArs > 0 ? formatCurrency(savingsArs) : "—"}
              </p>
              <p className="text-sm font-bold text-primary">
                {totalUsd > 0
                  ? `USD ${totalUsd.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : "—"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Gastos por Categoría + Transacciones — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Gastos por Categoría */}
        <div className="card p-4 min-h-[200px] flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-primary">Gastos por Categoría</h2>
              {selectedCategory && (
                <button
                  onClick={() => {
                    setSelectedCategory(null);
                  }}
                  className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  {selectedCategory} ✕
                </button>
              )}
            </div>
            <button
              onClick={() => navigate("/cat-dashboard")}
              className="text-xs text-secondary hover:text-primary transition-colors"
            >
              Ver detalle →
            </button>
          </div>
          {categories.length === 0 ? (
            <EmptyState
              icon="📊"
              title="Sin datos"
              description="Los gastos por categoría aparecerán aquí"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 overflow-y-auto flex-1 min-h-0">
              {/* Pie chart */}
              <div className="flex items-center justify-center">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="total"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={85}
                      innerRadius={40}
                      paddingAngle={1}
                      onClick={(entry) => handleCategorySelect(entry.name)}
                      style={{ cursor: "pointer" }}
                    >
                      {pieData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.color}
                          opacity={selectedCategory && selectedCategory !== entry.name ? 0.3 : 1}
                          stroke={selectedCategory === entry.name ? "var(--color-primary)" : "none"}
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--chart-tooltip-bg)",
                        borderColor: "var(--chart-tooltip-border)",
                        color: "var(--chart-tooltip-text)",
                        borderRadius: 10,
                        fontSize: 12,
                        padding: "8px 12px",
                        boxShadow: "var(--shadow-md)",
                      }}
                      formatter={(v: number, name: string) => {
                        const total = pieData.reduce((s, d) => s + d.total, 0);
                        const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
                        return [`${formatCurrency(v)} (${pct}%)`, name];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Bars */}
              <div className="space-y-2 overflow-y-auto flex-1 min-h-0 p-1">
                {categories.map((cat, i) => {
                  const pct = (cat.total / maxCatTotal) * 100;
                  const color = cat.category_color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
                  const isSelected = selectedCategory === cat.category_name;
                  const prevTotal = cat.previous_total ?? 0;
                  const variation = prevTotal > 0 ? ((cat.total - prevTotal) / prevTotal) * 100 : 0;
                  return (
                    <div
                      key={i}
                      onClick={() => handleCategorySelect(cat.category_name)}
                      className={`cursor-pointer rounded-lg p-2 transition-all ${
                        isSelected
                          ? "bg-primary/10 ring-1 ring-primary"
                          : selectedCategory
                            ? "opacity-40 hover:opacity-70"
                            : "hover:bg-base-alt"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-xs text-secondary font-medium">
                            {cat.category_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {prevTotal > 0 && (
                            <span
                              className={`text-[10px] font-medium ${
                                variation > 0
                                  ? "text-danger"
                                  : variation < 0
                                    ? "text-success"
                                    : "text-tertiary"
                              }`}
                            >
                              {variation > 0 ? "↑" : variation < 0 ? "↓" : "→"}
                              {Math.abs(variation).toFixed(0)}%
                            </span>
                          )}
                          <span className="text-xs font-semibold text-primary">
                            {formatCurrency(cat.total)}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-base-alt rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Transacciones */}
        <div className="card min-h-[200px] max-h-[340px] flex flex-col">
          <div className="px-4 py-3 border-b border-border-color flex items-center justify-between flex-shrink-0">
            <h2 className="text-sm font-semibold text-primary">
              Transacciones — Mes corriente
              {selectedCategory && (
                <span className="ml-2 text-xs font-normal text-secondary">
                  ({selectedCategory})
                </span>
              )}
            </h2>
            <button
              onClick={() => navigate("/expenses")}
              className="text-xs text-secondary hover:text-primary transition-colors"
            >
              Ver todos →
            </button>
          </div>
          {filteredExpenses.length === 0 ? (
            <EmptyState
              icon="💸"
              title={
                selectedCategory
                  ? `Sin gastos en ${selectedCategory}`
                  : "Sin transacciones este mes"
              }
              description={
                selectedCategory
                  ? "Probá seleccionando otra categoría"
                  : "Tus gastos del mes aparecerán aquí"
              }
              action={{ label: "Ver todos los gastos", onClick: () => navigate("/expenses") }}
            />
          ) : (
            <div className="divide-y divide-border-color overflow-y-auto flex-1 min-h-0">
              {filteredExpenses.map((exp) => (
                <div
                  key={exp.id}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-base-alt transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: exp.category_color || "#3584e4" }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary truncate">
                        {toUpperCase(exp.description)}
                      </p>
                      <p className="text-xs text-tertiary">
                        {formatDateDMYSlash(exp.date)}
                        {exp.category_name ? ` · ${exp.category_name}` : ""}
                        {exp.card ? ` · ${exp.card}` : ""}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-sm font-semibold flex-shrink-0 ml-2 ${
                      exp.amount < 0 ? "text-success" : "text-primary"
                    }`}
                  >
                    {exp.currency === "USD" && (
                      <span className="text-xs font-normal badge-success px-1.5 py-0.5 rounded mr-1">
                        USD
                      </span>
                    )}
                    {formatCurrency(exp.amount, exp.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tarjetas + Programados — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Credit cards */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-primary">Tarjetas de Crédito</h2>
            <button
              onClick={() => navigate("/accounts")}
              className="text-xs text-secondary hover:text-primary transition-colors"
            >
              Ver detalle →
            </button>
          </div>
          {cardData.length === 0 ? (
            <EmptyState
              icon="💳"
              title="Sin tarjetas registradas"
              description="Creá una tarjeta para ver el resumen de gastos"
              action={{ label: "Crear tarjeta", onClick: () => navigate("/accounts") }}
            />
          ) : (
            <div className="divide-y divide-border-color">
              {cardData
                .filter((c) => c.card_type === "credito")
                .map((card, i) => {
                  const monthEntry = card.monthly?.find((m) => m.month === month);
                  return (
                    <CardRow
                      key={i}
                      cardName={card.card_name}
                      bank={card.bank}
                      total={monthEntry?.total ?? 0}
                      cardType={card.card_type}
                      holder={card.holder}
                    />
                  );
                })}
            </div>
          )}
        </div>

        {/* Scheduled expenses */}
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-primary mb-3">Gastos programados</h2>
          {!scheduledData ||
          (scheduledData.installments.length === 0 && scheduledData.manual.length === 0) ? (
            <EmptyState
              icon="📅"
              title="Sin gastos programados"
              description="Los vencimientos del mes aparecerán aquí"
            />
          ) : (
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {scheduledData.installments.map((inst) => (
                <div
                  key={`inst-${inst.id}`}
                  className="flex items-start justify-between py-2 px-1 rounded hover:bg-base-alt transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">📦</span>
                    <div>
                      <p className="text-sm font-medium text-primary">
                        {toUpperCase(inst.description)}
                      </p>
                      <p className="text-xs text-tertiary">
                        {formatDateDMYSlash(inst.scheduled_date)} · {inst.installment_number}/
                        {inst.installment_total}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-primary">
                    {formatCurrency(inst.amount, inst.currency)}
                  </span>
                </div>
              ))}
              {scheduledData.manual.map((man) => (
                <div
                  key={`man-${man.id}`}
                  className="flex items-start justify-between py-2 px-1 rounded hover:bg-base-alt transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">📅</span>
                    <div>
                      <p className="text-sm font-medium text-primary">
                        {toUpperCase(man.description)}
                      </p>
                      <p className="text-xs text-tertiary">
                        {formatDateDMYSlash(man.scheduled_date)}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-primary">
                    {formatCurrency(man.amount, man.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Carga de cuotas + Top merchants — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Carga de cuotas mini chart */}
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-primary mb-3">Carga de Cuotas</h2>
          {monthlyLoad.length === 0 ? (
            <EmptyState
              icon="📦"
              title="Sin cuotas"
              description="Las cuotas comprometidas aparecerán aquí"
            />
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={monthlyLoad} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                  {monthlyLoad.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={
                        entry.is_current
                          ? "var(--color-primary)"
                          : entry.is_past
                            ? "var(--text-tertiary)"
                            : "var(--color-primary)"
                      }
                      opacity={entry.is_past ? 0.4 : 1}
                    />
                  ))}
                </Bar>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: "var(--chart-text)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => {
                    const [, m] = v.split("-");
                    return MONTHS_ES_SHORT[parseInt(m) - 1] || v;
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--chart-tooltip-bg)",
                    borderColor: "var(--chart-tooltip-border)",
                    color: "var(--chart-tooltip-text)",
                    borderRadius: 10,
                    fontSize: 12,
                    padding: "8px 12px",
                    boxShadow: "var(--shadow-md)",
                  }}
                  formatter={(v: number) => [formatCurrency(v), "Cuotas"]}
                  labelFormatter={(v) => {
                    const [y, m] = v.split("-");
                    return `${MONTHS_ES_SHORT[parseInt(m) - 1]} ${y}`;
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top merchants */}
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-primary mb-3">Top Comercios</h2>
          {topMerchants.length === 0 ? (
            <EmptyState
              icon="🏪"
              title="Sin datos"
              description="Los comercios con más gasto aparecerán aquí"
            />
          ) : (
            <div className="space-y-2.5">
              {topMerchants.map((m, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-1.5 px-1 rounded hover:bg-base-alt transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: m.category_color || "#94a3b8" }}
                    />
                    <span className="text-xs text-secondary font-medium truncate">
                      {toUpperCase(m.description)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span className="text-[10px] text-tertiary">{m.count}x</span>
                    <span className="text-xs font-semibold text-primary">
                      {formatCurrency(m.total_amount)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing !== undefined && (
        <ExpenseModal
          initial={editing}
          onClose={() => {
            setEditing(undefined);
            setSaveError(null);
          }}
          onSave={handleSave}
          saveError={saveError}
          isSaving={createMut.isPending}
        />
      )}
    </div>
  );
}
