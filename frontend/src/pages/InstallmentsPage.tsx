import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
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
  updateRecurringExpense,
} from "../api/client";
import type { InstallmentGroup, RecurringExpense, ExpenseCreate } from "../types";
import { formatCurrency, formatDateDMY, MONTHS_ES_SHORT } from "../utils/format";

const GNOME_COLORS = [
  "var(--gnome-blue-3)",
  "var(--gnome-green-3)",
  "var(--gnome-purple-3)",
  "var(--gnome-orange-3)",
  "var(--gnome-yellow-3)",
  "var(--gnome-red-3)",
];

type PaymentItem = {
  id: string | number;
  type: "installment" | "recurring";
  description: string;
  amount: number;
  category_name: string | null;
  category_color: string | null;
  next_date: string | null;
  installment_info: string;
  recurring_id?: number;
  is_active?: boolean;
};

export default function InstallmentsPage() {
  const queryClient = useQueryClient();
  const [showCompleted, setShowCompleted] = useState(false);
  const [showPaused, setShowPaused] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PaymentItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");

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
    queryKey: ["recurring", "all"],
    queryFn: () => getRecurringExpenses("all"),
    staleTime: 60_000,
  });

  const activeGroups = groups.filter((g) => g.remaining_installments > 0);
  const activeRecurring = recurringExpenses.filter((r) => r.is_active);
  const pausedRecurring = recurringExpenses.filter((r) => !r.is_active);

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthData = monthlyLoad.find((e) => e.month === currentMonth);
  const currentMonthTotal = currentMonthData?.total ?? 0;
  const currentMonthCount = currentMonthData?.count ?? 0;

  const totalPending = activeGroups.reduce(
    (s, g) => s + g.installment_amount * g.remaining_installments,
    0,
  );
  const recurringTotal = activeRecurring.reduce((s, r) => s + r.amount, 0);
  const recurringCount = activeRecurring.length;

  // Build unified payment list
  const allPayments = useMemo(() => {
    const items: PaymentItem[] = [];

    for (const g of activeGroups) {
      items.push({
        id: g.installment_group_id,
        type: "installment",
        description: g.description,
        amount: g.installment_amount,
        category_name: g.category_name,
        category_color: g.category_color,
        next_date: g.next_date,
        installment_info: `Cuota ${g.installments_paid + 1}/${g.installment_total}`,
      });
    }

    const recurringToShow = showPaused ? recurringExpenses : activeRecurring;
    for (const r of recurringToShow) {
      items.push({
        id: `rec-${r.id}`,
        type: "recurring",
        description: r.merchant_key || r.description,
        amount: r.amount,
        category_name: "Suscripciones",
        category_color: "var(--gnome-purple-3)",
        next_date: r.next_charge_date,
        installment_info: r.frequency === "monthly" ? "Mensual" : r.frequency,
        recurring_id: r.id,
        is_active: r.is_active,
      });
    }

    return items.sort((a, b) => {
      if (!a.next_date) return 1;
      if (!b.next_date) return -1;
      return a.next_date.localeCompare(b.next_date);
    });
  }, [activeGroups, activeRecurring, recurringExpenses, showPaused]);

  // Category breakdown for horizontal bar chart
  const categoryData = useMemo(() => {
    const catMap: Record<string, { value: number; color: string }> = {};
    for (const item of allPayments) {
      const name = item.category_name || "Sin categoría";
      if (!catMap[name]) {
        catMap[name] = { value: 0, color: item.category_color || "var(--gnome-purple-3)" };
      }
      catMap[name].value += item.amount * 12;
    }
    const total = Object.values(catMap).reduce((s, c) => s + c.value, 0);
    return Object.entries(catMap)
      .map(([name, data]) => ({
        name,
        value: data.value,
        color: data.color,
        percentage: total > 0 ? Math.round((data.value / total) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [allPayments]);

  // Scheduled expenses for selected group
  const { data: scheduledForGroup = [] } = useQuery({
    queryKey: ["scheduled-expenses", selectedItem?.id],
    queryFn: () =>
      getScheduledExpenses({
        installment_group_id: selectedItem?.id as string,
        status: "PENDING",
      }),
    enabled: !!selectedItem && selectedItem.type === "installment",
  });

  const executeMut = useMutation({
    mutationFn: executeScheduledExpense,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["installments"] });
      queryClient.invalidateQueries({ queryKey: ["scheduled-expenses"] });
    },
  });

  const cancelMut = useMutation({
    mutationFn: cancelScheduledExpense,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["installments"] });
      queryClient.invalidateQueries({ queryKey: ["scheduled-expenses"] });
    },
  });

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

  const updateRecurringMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateRecurringExpense(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      closeModal();
    },
  });

  const openGestionar = (item: PaymentItem) => {
    setSelectedItem(item);
    setEditAmount(item.amount.toString());
    setEditDate(item.next_date || "");
    setShowModal(true);
  };

  const closeModal = () => {
    setSelectedItem(null);
    setShowModal(false);
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
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Sin gastos programados</h2>
        <p className="text-sm mt-1 text-[var(--text-secondary)]">
          Importá extractos con cuotas o agregá suscripciones para ver la proyección.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-primary">Programados</h1>
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
          <p className="text-[10px] text-tertiary uppercase mb-1">Este mes</p>
          <p className="text-lg font-bold text-[var(--color-success)]">{currentMonthCount}</p>
          <p className="text-xs text-tertiary mt-1">{formatCurrency(currentMonthTotal)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] text-tertiary uppercase mb-1">Pendiente</p>
          <p className="text-lg font-bold text-[var(--color-primary)]">
            {formatCurrency(totalPending)}
          </p>
          <p className="text-xs text-tertiary mt-1">{activeGroups.length} grupos</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] text-tertiary uppercase mb-1">Recurrentes</p>
          <p className="text-lg font-bold text-[var(--gnome-purple-3)]">
            {formatCurrency(recurringTotal)}
          </p>
          <p className="text-xs text-tertiary mt-1">{recurringCount} gastos/mes</p>
        </div>
      </div>

      {/* BarChart: Tendencia mensual */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-primary mb-3">Tendencia mensual</h2>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={monthlyLoad} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
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
            <Bar dataKey="total" radius={[4, 4, 0, 0]}>
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
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Horizontal Bar Chart: Compromisos por categoría */}
      {categoryData.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-primary mb-3">Compromisos por categoría</h2>
          <div className="space-y-2">
            {categoryData.map((cat) => (
              <div key={cat.name} className="flex items-center gap-3 overflow-hidden">
                <span className="text-xs text-primary w-24 truncate flex-shrink-0">{cat.name}</span>
                <div className="flex-1 h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden min-w-0">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(cat.percentage, 2)}%`,
                      backgroundColor: cat.color,
                    }}
                  />
                </div>
                <span className="text-xs text-tertiary flex-shrink-0 text-right">
                  {formatCurrency(cat.value / 12)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Próximos pagos: Unified list sorted by date */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-primary">Próximos pagos</h2>
          {pausedRecurring.length > 0 && (
            <button
              onClick={() => setShowPaused(!showPaused)}
              className="text-xs text-tertiary hover:text-primary transition"
            >
              {showPaused ? "Ocultar pausadas" : `Mostrar pausadas (${pausedRecurring.length})`}
            </button>
          )}
        </div>

        {allPayments.length === 0 ? (
          <p className="text-sm text-tertiary py-4 text-center">Sin pagos próximos</p>
        ) : (
          <div className="divide-y divide-border-color">
            {allPayments.map((item) => {
              const isPaused = item.type === "recurring" && item.is_active === false;
              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between py-3 ${
                    isPaused ? "opacity-50" : ""
                  } ${
                    item.type === "installment"
                      ? "bg-[var(--gnome-blue-5)]/[0.03]"
                      : "bg-[var(--gnome-purple-5)]/[0.03]"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                        item.type === "installment"
                          ? "bg-[var(--gnome-blue-1)]/20 text-[var(--gnome-blue-5)]"
                          : "bg-[var(--gnome-purple-1)]/20 text-[var(--gnome-purple-3)]"
                      }`}
                    >
                      {item.description.charAt(0)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-primary truncate">
                          {item.description}
                        </p>
                        {item.category_name && (
                          <span className="flex items-center gap-1 flex-shrink-0">
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{
                                backgroundColor: item.category_color || "var(--gnome-purple-3)",
                              }}
                            />
                            <span className="text-[10px] text-tertiary">{item.category_name}</span>
                          </span>
                        )}
                        {isPaused && (
                          <span className="text-[10px] text-[var(--gnome-yellow-4)] font-medium flex-shrink-0">
                            PAUSADO
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-tertiary">
                        {item.installment_info}
                        {item.next_date && (
                          <span className="ml-2">· Próx: {formatDateDMY(item.next_date)}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm font-medium text-primary">
                      {formatCurrency(item.amount)}
                    </span>
                    <button
                      onClick={() => openGestionar(item)}
                      className="p-1.5 rounded-md hover:bg-[var(--color-base-alt)] transition"
                      title="Gestionar"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="2" fill="currentColor" />
                        <circle cx="8" cy="2.5" r="1.5" fill="currentColor" />
                        <circle cx="8" cy="13.5" r="1.5" fill="currentColor" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Gestionar Modal */}
      {showModal && selectedItem && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={closeModal}
        >
          <div
            className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-primary">
                Detalle: {selectedItem.description}
              </h2>
              <button
                onClick={closeModal}
                className="p-1 rounded hover:bg-[var(--color-base-alt)] transition"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M3 3l10 10M13 3L3 13"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {/* Info */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-[10px] text-tertiary uppercase">Tipo</p>
                <p className="text-sm text-primary">
                  {selectedItem.type === "installment" ? "Cuota" : "Suscripción"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-tertiary uppercase">Monto</p>
                <p className="text-sm font-medium text-primary">
                  {formatCurrency(selectedItem.amount)}
                </p>
              </div>
              {selectedItem.category_name && (
                <div>
                  <p className="text-[10px] text-tertiary uppercase">Categoría</p>
                  <p className="text-sm text-primary">{selectedItem.category_name}</p>
                </div>
              )}
              {selectedItem.next_date && (
                <div>
                  <p className="text-[10px] text-tertiary uppercase">Próximo pago</p>
                  <p className="text-sm text-primary">{formatDateDMY(selectedItem.next_date)}</p>
                </div>
              )}
            </div>

            {/* Scheduled payments for installments */}
            {selectedItem.type === "installment" && scheduledForGroup.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-primary mb-2">Próximos pagos</h3>
                <div className="divide-y divide-border-color">
                  {scheduledForGroup.map((payment: any) => (
                    <div key={payment.id} className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm text-primary">
                          Cuota {payment.installment_number}/{payment.installment_total}
                        </p>
                        <p className="text-xs text-tertiary">
                          {formatDateDMY(payment.scheduled_date)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-primary">
                          {formatCurrency(payment.amount)}
                        </span>
                        <button
                          onClick={() => executeMut.mutate(payment.id)}
                          className="text-xs underline text-[var(--color-primary)] hover:text-[var(--text-primary)]"
                        >
                          Ejecutar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t border-[var(--border-color)]">
              {selectedItem.type === "recurring" && (
                <>
                  {/* Inline edit form for recurring */}
                  <div className="flex-1">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-[10px] text-tertiary uppercase">Monto</label>
                        <input
                          type="number"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className="input text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-tertiary uppercase">Próximo cargo</label>
                        <input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          className="input text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          updateRecurringMut.mutate({
                            id: selectedItem.recurring_id!,
                            data: {
                              amount: parseFloat(editAmount),
                              next_charge_date: editDate,
                            },
                          });
                        }}
                        className="gnome-btn-primary-round text-sm"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => {
                          handlePauseRecurring(selectedItem.recurring_id!);
                          closeModal();
                        }}
                        className="gnome-btn-secondary-round text-sm"
                      >
                        {selectedItem.is_active ? "Pausar" : "Reanudar"}
                      </button>
                      <button
                        onClick={() => {
                          handleDeleteRecurring(selectedItem.recurring_id!);
                          closeModal();
                        }}
                        className="gnome-btn-danger-round text-sm"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </>
              )}
              <button onClick={closeModal} className="gnome-btn-secondary-round text-sm ml-auto">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
