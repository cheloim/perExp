import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Bar, XAxis, Tooltip, ResponsiveContainer, Cell, ComposedChart, Line } from "recharts";
import {
  getInstallmentsDashboard,
  getInstallmentsMonthlyLoad,
  getScheduledExpenses,
  executeScheduledExpense,
  getRecurringExpenses,
  pauseRecurringExpense,
  deleteRecurringExpense,
  updateRecurringExpense,
} from "../api/client";
import { formatCurrency, formatDateDMY, MONTHS_ES_SHORT } from "../utils/format";
import AutoDetectedBanner from "../components/AutoDetectedBanner";
import { ConfirmDialog } from "../components/ConfirmDialog";

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
  const [searchParams] = useSearchParams();
  const [showCompleted, setShowCompleted] = useState(false);
  const [showPaused, setShowPaused] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PaymentItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [listFilter, setListFilter] = useState<"all" | "cuotas" | "recurrentes">(
    searchParams.get("filter") === "recurring" ? "recurrentes" : "all",
  );
  const [deleteRecurringId, setDeleteRecurringId] = useState<number | null>(null);

  // Close modal on Escape key
  useEffect(() => {
    if (!showModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showModal]);

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
        next_date: r.next_charge_date || null,
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

  // Filtered payments based on listFilter
  const filteredPayments = useMemo(() => {
    if (listFilter === "cuotas") return allPayments.filter((p) => p.type === "installment");
    if (listFilter === "recurrentes") return allPayments.filter((p) => p.type === "recurring");
    return allPayments;
  }, [allPayments, listFilter]);

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

  const handlePauseRecurring = async (id: number) => {
    await pauseRecurringExpense(id);
    queryClient.invalidateQueries({ queryKey: ["recurring"] });
  };

  const handleDeleteRecurring = async (id: number) => {
    setDeleteRecurringId(id);
  };

  const confirmDeleteRecurring = async () => {
    if (deleteRecurringId) {
      await deleteRecurringExpense(deleteRecurringId);
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      setDeleteRecurringId(null);
      closeModal();
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
      {/* Auto-detected recurring expenses banner */}
      <AutoDetectedBanner />

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

      {/* Charts: BarChart (focus) + Horizontal bar (compact) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* BarChart: Tendencia mensual (2 columns - main focus) */}
        <div className="lg:col-span-2 card p-4">
          <h2 className="text-sm font-semibold text-primary mb-3">Tendencia mensual</h2>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={monthlyLoad} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
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
              <Line
                type="monotone"
                dataKey="total"
                stroke="var(--gnome-purple-3)"
                strokeWidth={2}
                dot={{ r: 3, fill: "var(--gnome-purple-3)" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Horizontal Bar Chart: Compromisos por categoría (1 column - compact) */}
        {categoryData.length > 0 && (
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-primary mb-3">Por categoría</h2>
            <div className="space-y-2">
              {categoryData.map((cat) => (
                <div key={cat.name} className="flex items-center gap-3 overflow-hidden">
                  <span className="text-xs text-primary w-24 truncate flex-shrink-0">
                    {cat.name}
                  </span>
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
      </div>

      {/* Próximos pagos: Unified list sorted by date */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-primary">Próximos pagos</h2>
          <div className="flex items-center gap-2">
            {pausedRecurring.length > 0 && (
              <button
                onClick={() => setShowPaused(!showPaused)}
                className="text-xs text-tertiary hover:text-primary transition"
              >
                {showPaused ? "Ocultar pausadas" : `Mostrar pausadas (${pausedRecurring.length})`}
              </button>
            )}
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex gap-1 mb-3">
          {[
            { key: "all" as const, label: "Todos", count: allPayments.length },
            {
              key: "cuotas" as const,
              label: "Cuotas",
              count: allPayments.filter((p) => p.type === "installment").length,
              color: "bg-gnomeBlue5",
            },
            {
              key: "recurrentes" as const,
              label: "Recurrentes",
              count: allPayments.filter((p) => p.type === "recurring").length,
              color: "bg-gnomePurple5",
            },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setListFilter(listFilter === f.key ? "all" : f.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-all flex items-center gap-1 ${
                listFilter === f.key
                  ? "bg-primary text-on-primary border-primary"
                  : "border-border-color text-tertiary hover:text-primary"
              }`}
            >
              {f.color && <span className={`w-1.5 h-1.5 rounded-full ${f.color}`} />}
              {f.label}
              <span className="text-[10px] opacity-60">({f.count})</span>
            </button>
          ))}
        </div>

        {filteredPayments.length === 0 ? (
          <p className="text-sm text-tertiary py-4 text-center">Sin pagos próximos</p>
        ) : (
          <div className="space-y-1">
            {filteredPayments.map((item) => {
              const isPaused = item.type === "recurring" && item.is_active === false;
              const isInstallment = item.type === "installment";
              return (
                <button
                  key={item.id}
                  onClick={() => openGestionar(item)}
                  className={`w-full flex items-center justify-between py-3 px-3 rounded-lg transition hover:ring-1 hover:ring-[var(--border-color)] ${
                    isPaused ? "opacity-50" : ""
                  } ${isInstallment ? "bg-gnomeBlue5/5" : "bg-gnomePurple5/5"}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                        isInstallment
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
                  <span className="text-sm font-medium text-primary flex-shrink-0">
                    {formatCurrency(item.amount)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Gestionar Modal */}
      {showModal && selectedItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-backdrop bg-black/60"
          onClick={closeModal}
        >
          <div
            className="relative bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col animate-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
              <div className="min-w-0 flex-1">
                <h2
                  className="text-base font-semibold truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {selectedItem.description}
                </h2>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {selectedItem.type === "installment" ? "Cuota" : "Suscripción"}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="ml-3 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xl flex-shrink-0"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 p-5">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4">
                <div>
                  <p className="text-[var(--text-tertiary)] text-xs uppercase">Monto</p>
                  <p className="font-medium text-[var(--text-primary)]">
                    {formatCurrency(selectedItem.amount)}
                  </p>
                </div>
                {selectedItem.category_name && (
                  <div>
                    <p className="text-[var(--text-tertiary)] text-xs uppercase">Categoría</p>
                    <p className="text-[var(--text-primary)]">{selectedItem.category_name}</p>
                  </div>
                )}
                {selectedItem.next_date && (
                  <div>
                    <p className="text-[var(--text-tertiary)] text-xs uppercase">Próximo pago</p>
                    <p className="text-[var(--text-primary)]">
                      {formatDateDMY(selectedItem.next_date)}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-[var(--text-tertiary)] text-xs uppercase">Tipo</p>
                  <p className="text-[var(--text-primary)]">{selectedItem.installment_info}</p>
                </div>
              </div>

              {/* Scheduled payments for installments */}
              {selectedItem.type === "installment" && scheduledForGroup.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                    Próximos pagos ({scheduledForGroup.length})
                  </h3>
                  <div className="divide-y divide-[var(--border-color)]">
                    {scheduledForGroup.slice(0, 5).map((payment: any) => (
                      <div key={payment.id} className="flex items-center justify-between py-2">
                        <div>
                          <p className="text-sm text-[var(--text-primary)]">
                            Cuota {payment.installment_number}/{payment.installment_total}
                          </p>
                          <p className="text-xs text-[var(--text-tertiary)]">
                            {formatDateDMY(payment.scheduled_date)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[var(--text-primary)]">
                            {formatCurrency(payment.amount)}
                          </span>
                          <button
                            onClick={() => executeMut.mutate(payment.id)}
                            className="text-xs text-[var(--color-primary)] hover:underline"
                          >
                            Ejecutar
                          </button>
                        </div>
                      </div>
                    ))}
                    {scheduledForGroup.length > 5 && (
                      <p className="text-xs text-[var(--text-tertiary)] py-2 text-center">
                        +{scheduledForGroup.length - 5} más...
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Edit form for recurring */}
              {selectedItem.type === "recurring" && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Editar</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
                        Monto
                      </label>
                      <input
                        type="number"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        className="input w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
                        Próximo cargo
                      </label>
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="input w-full"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-[var(--border-color)] flex-shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {selectedItem.type === "recurring" && (
                    <>
                      <button
                        onClick={() => {
                          handlePauseRecurring(selectedItem.recurring_id!);
                          closeModal();
                        }}
                        className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                      >
                        {selectedItem.is_active ? "Pausar" : "Reanudar"}
                      </button>
                      <span className="text-[var(--border-color)]">·</span>
                      <button
                        onClick={() => {
                          handleDeleteRecurring(selectedItem.recurring_id!);
                        }}
                        className="text-xs text-[var(--gnome-red-3)] hover:underline"
                      >
                        Eliminar
                      </button>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={closeModal}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
                  >
                    Cerrar
                  </button>
                  {selectedItem.type === "recurring" && (
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
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-110 transition"
                    >
                      Guardar
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete recurring */}
      <ConfirmDialog
        isOpen={deleteRecurringId !== null}
        title="Eliminar gasto recurrente"
        message="¿Eliminar esta suscripción permanentemente? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={confirmDeleteRecurring}
        onCancel={() => setDeleteRecurringId(null)}
        variant="danger"
      />
    </div>
  );
}
