import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import {
  getInstallmentsDashboard,
  getInstallmentsMonthlyLoad,
  getScheduledExpenses,
  executeScheduledExpense,
  cancelScheduledExpense,
  getRecurringExpenses,
  pauseRecurringExpense,
  deleteRecurringExpense,
} from "../api/client";
import type { InstallmentGroup, ExpenseCreate } from "../types";
import type { RecurringExpense } from "../api/client";
import { formatCurrency, formatDateDMY, MONTHS_ES_SHORT } from "../utils/format";

const GNOME_COLORS = [
  "var(--gnome-blue-3)",
  "var(--gnome-green-3)",
  "var(--gnome-purple-3)",
  "var(--gnome-orange-3)",
  "var(--gnome-yellow-3)",
  "var(--gnome-red-3)",
];

export default function InstallmentsPage() {
  const queryClient = useQueryClient();
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<InstallmentGroup | null>(null);
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["installments"],
    queryFn: getInstallmentsDashboard,
    staleTime: 60_000,
  });

  const { data: monthlyLoad = [] } = useQuery({
    queryKey: ["installments-monthly-load"],
    queryFn: getInstallmentsMonthlyLoad,
    staleTime: 60_000,
  });

  const { data: recurringExpenses = [] } = useQuery({
    queryKey: ["recurring", "active"],
    queryFn: () => getRecurringExpenses("active"),
    staleTime: 60_000,
  });

  const activeGroups = groups.filter((g) => g.remaining_installments > 0);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthData = monthlyLoad.find((e) => e.month === currentMonth);
  const currentMonthTotal = currentMonthData?.total ?? 0;
  const currentMonthCount = currentMonthData?.count ?? 0;

  const totalPending = activeGroups.reduce(
    (s, g) => s + g.installment_amount * g.remaining_installments,
    0,
  );

  const recurringTotal = recurringExpenses.reduce((s, r) => s + r.amount, 0);
  const recurringCount = recurringExpenses.length;

  // Build timeline items from installments + recurring
  const timelineItems = useMemo(() => {
    const items: { id: string; date: string; description: string; amount: number; type: string }[] =
      [];

    // Add installment groups with next payment date
    for (const g of activeGroups) {
      const nextDate = g.next_payment_date || g.expenses?.[0]?.date;
      if (nextDate) {
        items.push({
          id: `inst-${g.id}`,
          date: nextDate,
          description: g.description,
          amount: g.installment_amount,
          type: "installment",
        });
      }
    }

    // Add recurring expenses
    for (const r of recurringExpenses) {
      if (r.next_charge_date) {
        items.push({
          id: `rec-${r.id}`,
          date: r.next_charge_date,
          description: r.description,
          amount: r.amount,
          type: "recurring",
        });
      }
    }

    // Sort by date
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }, [activeGroups, recurringExpenses]);

  // Build category distribution for donut
  const categoryData = useMemo(() => {
    const catMap: Record<string, number> = {};

    // From installments
    for (const g of activeGroups) {
      const name = g.category_name || "Sin categoría";
      catMap[name] = (catMap[name] || 0) + g.installment_amount * g.remaining_installments;
    }

    // From recurring
    for (const r of recurringExpenses) {
      const name = r.category_id ? "Suscripciones" : "Sin categoría";
      catMap[name] = (catMap[name] || 0) + r.amount * 12; // Annualize for donut
    }

    const total = Object.values(catMap).reduce((s, v) => s + v, 0);
    return Object.entries(catMap)
      .map(([name, value]) => ({
        name,
        value,
        percentage: total > 0 ? Math.round((value / total) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [activeGroups, recurringExpenses]);

  const handlePauseRecurring = async (id: number) => {
    await pauseRecurringExpense(id);
    queryClient.invalidateQueries({ queryKey: ["recurring"] });
  };

  const handleDeleteRecurring = async (id: number) => {
    if (confirm("¿Eliminar esta suscripción permanentemente?")) {
      await deleteRecurringExpense(id);
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--color-primary)] border-t-transparent" />
      </div>
    );
  }

  if (groups.length === 0 && recurringExpenses.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-4">💳</p>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Sin gastos programados
        </h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          Importá extractos con cuotas o agregá suscripciones para ver la proyección.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-primary">Compromisos</h1>
        <button
          onClick={() => setShowCompleted(!showCompleted)}
          className="gnome-btn-secondary-round text-sm"
        >
          {showCompleted ? "Ocultar completadas" : "Mostrar completadas"}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
            Este mes
          </p>
          <p className="text-2xl font-bold" style={{ color: "var(--color-success)" }}>
            {currentMonthCount}
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {formatCurrency(currentMonthTotal)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
            Total pendiente
          </p>
          <p className="text-2xl font-bold" style={{ color: "var(--color-primary)" }}>
            {formatCurrency(totalPending)}
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {activeGroups.length} grupos
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
            Recurrentes
          </p>
          <p className="text-2xl font-bold" style={{ color: "var(--gnome-purple-3)" }}>
            {formatCurrency(recurringTotal)}
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {recurringCount} gastos/mes
          </p>
        </div>
      </div>

      {/* Two-Column Layout: Timeline + Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Timeline */}
        <div className="card p-5">
          <h2 className="text-base font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
            Próximos cargos
          </h2>
          {timelineItems.length === 0 ? (
            <p className="text-sm text-tertiary">Sin cargos próximos</p>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
              {(() => {
                // Group by date
                const grouped: Record<string, typeof timelineItems> = {};
                for (const item of timelineItems) {
                  const dateKey = item.date;
                  if (!grouped[dateKey]) grouped[dateKey] = [];
                  grouped[dateKey].push(item);
                }

                return Object.entries(grouped).map(([dateKey, entries]) => (
                  <div key={dateKey}>
                    <p className="text-xs font-semibold text-[var(--gnome-purple-3)] mb-1.5">
                      {formatDateDMY(dateKey)}
                    </p>
                    {entries.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[var(--color-base-alt)]"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded bg-[var(--color-primary)]/10 flex items-center justify-center text-xs font-bold text-[var(--color-primary)]">
                            {entry.description.charAt(0).toUpperCase()}
                          </span>
                          <span className="text-sm text-primary">{entry.description}</span>
                        </div>
                        <span className="text-sm font-medium text-primary">
                          {formatCurrency(entry.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                ));
              })()}
            </div>
          )}
        </div>

        {/* Right: Donut + Legend */}
        <div className="card p-5">
          <h2 className="text-base font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
            Distribución
          </h2>
          {categoryData.length === 0 ? (
            <p className="text-sm text-tertiary">Sin datos para mostrar</p>
          ) : (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {categoryData.map((_, index) => (
                      <Cell key={index} fill={GNOME_COLORS[index % GNOME_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {categoryData.map((item, index) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: GNOME_COLORS[index % GNOME_COLORS.length] }}
                    />
                    <span className="text-sm text-primary">{item.name}</span>
                    <span className="text-xs text-tertiary ml-auto">{item.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recurrentes Section */}
      <div className="flex items-center gap-3 my-6">
        <div className="h-px flex-1 bg-[var(--border-color)]" />
        <span className="text-xs font-semibold text-[var(--gnome-purple-3)] uppercase tracking-wider">
          Recurrentes
        </span>
        <div className="h-px flex-1 bg-[var(--border-color)]" />
      </div>

      {recurringExpenses.length > 0 ? (
        <div className="space-y-2">
          {recurringExpenses.map((rec) => {
            const daysUntil = rec.next_charge_date
              ? Math.max(
                  0,
                  Math.ceil((new Date(rec.next_charge_date).getTime() - Date.now()) / 86400000),
                )
              : null;

            return (
              <div key={rec.id} className="card p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-[var(--gnome-purple-1)]/20 flex items-center justify-center text-sm font-bold text-[var(--gnome-purple-3)]">
                      {rec.description.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-primary">{rec.description}</p>
                      <p className="text-xs text-tertiary">
                        {formatCurrency(rec.amount)}/mes
                        {rec.next_charge_date && (
                          <span className="ml-2">
                            · Próx: {formatDateDMY(rec.next_charge_date)}
                            {daysUntil !== null && daysUntil <= 3 && (
                              <span className="text-[var(--gnome-yellow-4)]"> ({daysUntil}d)</span>
                            )}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handlePauseRecurring(rec.id)}
                      className="p-1.5 rounded-md hover:bg-[var(--color-base-alt)] transition"
                      title={rec.is_active ? "Pausar" : "Reanudar"}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        {rec.is_active ? (
                          <>
                            <rect x="3" y="2" width="4" height="12" rx="0.5" fill="currentColor" />
                            <rect x="9" y="2" width="4" height="12" rx="0.5" fill="currentColor" />
                          </>
                        ) : (
                          <path d="M4 2l10 6-10 6V2z" fill="currentColor" />
                        )}
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteRecurring(rec.id)}
                      className="p-1.5 rounded-md hover:bg-[var(--color-base-alt)] transition text-[var(--gnome-red-3)]"
                      title="Eliminar"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card p-8 text-center">
          <p className="text-sm text-tertiary">
            Sin gastos recurrentes detectados. Los gastos que se repiten mensualmente aparecen aquí
            automáticamente.
          </p>
        </div>
      )}

      {/* BarChart: Tendencia Mensual */}
      <div className="card p-5">
        <h2 className="text-base font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          Tendencia mensual
        </h2>
        <ResponsiveContainer width="100%" height={windowWidth < 640 ? 180 : 260}>
          <BarChart data={monthlyLoad} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10, fill: "var(--chart-text)" }}
              tickFormatter={(v) => {
                const [, m] = v.split("-");
                return MONTHS_ES_SHORT[parseInt(m) - 1];
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--chart-tooltip-bg)",
                borderColor: "var(--chart-tooltip-border)",
                color: "var(--chart-tooltip-text)",
              }}
              formatter={(v: number) => [formatCurrency(v), "Total"]}
            />
            <Bar dataKey="total" fill="var(--color-primary)" radius={[4, 4, 0, 0]}>
              {monthlyLoad.map((entry, index) => (
                <Cell
                  key={index}
                  fill={
                    entry.is_current
                      ? "var(--color-success)"
                      : entry.is_past
                        ? "var(--gnome-yellow-3)"
                        : "var(--color-primary)"
                  }
                />
              ))}
            </Bar>
            <ReferenceLine
              y={currentMonthTotal}
              stroke="var(--gnome-yellow-3)"
              strokeDasharray="3 3"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
