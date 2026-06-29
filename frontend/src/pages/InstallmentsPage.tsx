import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import {
  getInstallmentsDashboard,
  getInstallmentsMonthlyLoad,
  getScheduledExpenses,
  executeScheduledExpense,
  cancelScheduledExpense,
  createExpense,
} from "../api/client";
import type { InstallmentGroup, ExpenseCreate } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ExpenseModal } from "../components/ExpenseModals";
import { formatCurrency, toUpperCase, formatDateDMY, MONTHS_ES_SHORT } from "../utils/format";

export default function InstallmentsPage() {
  const queryClient = useQueryClient();
  const [paymentFilter, setPaymentFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<InstallmentGroup | null>(null);
  const [showScheduledModal, setShowScheduledModal] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState<number | null>(null);
  const [editing, setEditing] = useState<null | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (data: ExpenseCreate) => createExpense(data),
    onSuccess: () => {
      setEditing(undefined);
      queryClient.invalidateQueries({ queryKey: ["installments"] });
      queryClient.invalidateQueries({ queryKey: ["installments-monthly-load"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err: Error) => setSaveError(err.message),
  });

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

  const { data: scheduledForGroup = [], isLoading: scheduledLoading } = useQuery({
    queryKey: ["scheduled-expenses", selectedGroup?.installment_group_id],
    queryFn: () =>
      getScheduledExpenses({
        installment_group_id: selectedGroup?.installment_group_id,
        status: "PENDING",
      }),
    enabled: !!selectedGroup,
  });

  const executeMutation = useMutation({
    mutationFn: executeScheduledExpense,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["installments"] });
      queryClient.invalidateQueries({ queryKey: ["scheduled-expenses"] });
    },
    onError: () => alert("Error al ejecutar el pago"),
  });

  useEffect(() => {
    if (!showScheduledModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowScheduledModal(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showScheduledModal]);

  const cancelMutation = useMutation({
    mutationFn: cancelScheduledExpense,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["installments"] });
      queryClient.invalidateQueries({ queryKey: ["scheduled-expenses"] });
    },
    onError: () => alert("Error al cancelar"),
  });

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const activeGroups = groups.filter((g) => g.remaining_installments > 0);

  const totalPending = activeGroups.reduce(
    (s, g) => s + g.installment_amount * g.remaining_installments,
    0,
  );

  const currentMonthData = monthlyLoad.find((e) => e.month === currentMonth);
  const currentMonthTotal = currentMonthData?.total ?? 0;
  const currentMonthCount = currentMonthData?.count ?? 0;

  const paymentMethods = [
    ...new Set(groups.map((g) => (g.card ? `${g.bank} · ${g.card}` : g.bank || "Sin definir"))),
  ].sort();
  const categories = [...new Set(groups.map((g) => g.category_name).filter(Boolean))].sort();
  const persons = [...new Set(groups.map((g) => g.person).filter(Boolean))].sort();

  const filtered = groups.filter((g) => {
    if (!showCompleted && g.remaining_installments === 0) return false;
    if (paymentFilter) {
      const displayKey = g.card ? `${g.bank} · ${g.card}` : g.bank || "Sin definir";
      if (displayKey !== paymentFilter) return false;
    }
    if (categoryFilter && g.category_name !== categoryFilter) return false;
    if (personFilter && g.person !== personFilter) return false;
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--color-primary)] border-t-transparent" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-4">💳</p>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Sin compras en cuotas
        </h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          Importá extractos con cuotas para ver la proyección.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-primary">Gastos en Cuotas</h1>
        <button onClick={() => setEditing(null)} className="gnome-btn-primary-round text-sm">
          <span className="text-base leading-none">+</span>
          <span>Nuevo gasto</span>
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-5">
          <div className="card p-5">
            <h2 className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
              Carga Mensual En Cuotas
            </h2>
            {(() => {
              const currentEntry = monthlyLoad.find((e) => e.is_current);
              const currentTotal = currentEntry?.total ?? 0;
              return (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={monthlyLoad} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      {monthlyLoad.map((e) => {
                        let baseColor = "var(--color-primary)";
                        if (e.is_current) baseColor = "var(--color-success)";
                        else if (e.is_past) baseColor = "var(--gnome-yellow-3)";
                        else if (currentTotal > 0)
                          baseColor =
                            e.total > currentTotal ? "var(--color-danger)" : "var(--color-primary)";
                        return (
                          <linearGradient
                            key={e.month}
                            id={`bar-${e.month}`}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop offset="0%" stopColor={baseColor} stopOpacity={1} />
                            <stop offset="100%" stopColor={baseColor} stopOpacity={0.55} />
                          </linearGradient>
                        );
                      })}
                    </defs>
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: "var(--chart-text)" }}
                      tickFormatter={(v: string) => {
                        const [y, m] = v.split("-");
                        return `${MONTHS_ES_SHORT[parseInt(m) - 1]} ${y.slice(2)}`;
                      }}
                      axisLine={false}
                      tickLine={false}
                    />
                    {currentTotal > 0 && (
                      <ReferenceLine
                        y={currentTotal}
                        stroke="var(--text-tertiary)"
                        strokeDasharray="4 4"
                        strokeWidth={1}
                      />
                    )}
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--chart-tooltip-bg)",
                        borderColor: "var(--chart-tooltip-border)",
                        color: "var(--chart-tooltip-text)",
                        borderRadius: 12,
                        boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
                      }}
                      labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                      itemStyle={{ color: "var(--chart-tooltip-text)" }}
                      formatter={(v: number, _: string, props: any) => {
                        const entry = props.payload;
                        const kind = entry?.is_current
                          ? "Mes actual"
                          : entry?.is_past
                          ? "Pagado"
                          : "Proyectado";
                        if (!entry?.is_current && currentTotal > 0) {
                          const pct = ((v - currentTotal) / currentTotal) * 100;
                          const sign = pct > 0 ? "+" : "";
                          const color = pct > 0 ? "var(--color-danger)" : "var(--color-success)";
                          return [
                            <span>
                              {formatCurrency(v)}{" "}
                              <span style={{ color, fontWeight: 700 }}>
                                ({sign}
                                {pct.toFixed(2)}%)
                              </span>
                            </span>,
                            kind,
                          ];
                        }
                        return [formatCurrency(v), kind];
                      }}
                      labelFormatter={(l: string) => {
                        const [y, m] = l.split("-");
                        return `${MONTHS_ES_SHORT[parseInt(m) - 1]} ${y}`;
                      }}
                    />
                    <Bar
                      dataKey="total"
                      radius={[4, 4, 0, 0]}
                      label={{
                        position: "top",
                        fontSize: 10,
                        fill: "var(--text-secondary)",
                        formatter: (v: number) =>
                          new Intl.NumberFormat("es-AR", { notation: "compact" }).format(v),
                      }}
                    >
                      {monthlyLoad.map((e) => (
                        <Cell
                          key={e.month}
                          fill={`url(#bar-${e.month})`}
                          fillOpacity={e.is_past ? 0.7 : 1}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>

          <div className="card overflow-hidden">
            <div
              className="px-5 py-3 border-b flex items-center justify-between"
              style={{ borderColor: "var(--border-color)" }}
            >
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                Compras En Cuotas
                <span className="ml-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                  {filtered.length} registros
                </span>
              </h2>
              <button
                onClick={() => setShowCompleted((v) => !v)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                  showCompleted ? "" : ""
                }`}
                style={{
                  backgroundColor: showCompleted ? "var(--color-primary)" : "transparent",
                  color: showCompleted ? "var(--color-on-primary)" : "var(--text-secondary)",
                  borderColor: showCompleted ? "var(--color-primary)" : "var(--border-color)",
                }}
              >
                {showCompleted ? "Ocultar completadas" : "Mostrar completadas"}
              </button>
            </div>

            {filtered.length === 0 ? (
              <p className="text-sm text-center py-10" style={{ color: "var(--text-secondary)" }}>
                Sin resultados para los filtros seleccionados
              </p>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--border-color)" }}>
                {filtered.map((g) => {
                  const pct =
                    g.installment_total > 0 ? (g.installments_paid / g.installment_total) * 100 : 0;
                  const done = g.remaining_installments === 0;
                  return (
                    <div
                      key={g.installment_group_id}
                      className="px-5 py-3 hover:bg-[var(--color-base-alt)] transition-colors cursor-pointer"
                      style={{ backgroundColor: "transparent" }}
                      onClick={() => {
                        if (g.remaining_installments > 0) {
                          setSelectedGroup(g);
                          setShowScheduledModal(true);
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
                            style={{ backgroundColor: g.category_color || "#3584e4" }}
                          />
                          <div className="min-w-0">
                            <p
                              className="text-sm font-medium truncate"
                              style={{
                                color: done ? "var(--text-secondary)" : "var(--text-primary)",
                              }}
                            >
                              {toUpperCase(g.description)}
                              {g.remaining_installments > 0 && (
                                <span
                                  className="ml-2 text-[10px] px-1.5 py-0.5 rounded"
                                  style={{
                                    backgroundColor: "var(--color-base-alt)",
                                    color: "var(--text-secondary)",
                                  }}
                                >
                                  {g.remaining_installments} programada
                                  {g.remaining_installments > 1 ? "s" : ""}
                                </span>
                              )}
                            </p>
                            <p
                              className="text-xs mt-0.5"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              {g.person && (
                                <span className="text-[var(--color-primary)]">{g.person}</span>
                              )}
                              {g.person && g.bank ? " · " : ""}
                              {g.bank}
                              {g.card ? ` · ${g.card}` : ""}
                              {g.next_date && !done && (
                                <> · próxima: {formatDateDMY(g.next_date, "—")}</>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                          <div>
                            <p
                              className="text-sm font-medium"
                              style={{
                                color: done ? "var(--text-secondary)" : "var(--text-primary)",
                              }}
                            >
                              {formatCurrency(g.installment_amount, g.currency)}
                            </p>
                            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                              {done ? (
                                <span style={{ color: "var(--color-success)" }}>✓ Completada</span>
                              ) : (
                                <>
                                  {g.remaining_installments} restante
                                  {g.remaining_installments !== 1 ? "s" : ""}
                                </>
                              )}
                            </p>
                          </div>
                          {g.remaining_installments > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedGroup(g);
                                setShowScheduledModal(true);
                              }}
                              className="text-xs underline transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              Gestionar
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <div
                          className="flex-1 h-1.5 rounded-full overflow-hidden"
                          style={{ backgroundColor: "var(--color-base-alt)" }}
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: g.category_color || "#3584e4",
                            }}
                          />
                        </div>
                        <span
                          className="text-[10px] flex-shrink-0"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {g.installments_paid}/{g.installment_total}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="xl:col-span-1">
          <div className="card p-5 sticky top-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                Filtros
              </h2>
              {(paymentFilter || categoryFilter) && (
                <button
                  onClick={() => {
                    setPaymentFilter(null);
                    setCategoryFilter(null);
                  }}
                  className="text-xs transition-colors hover:text-[var(--text-primary)]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Limpiar
                </button>
              )}
            </div>

            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              {filtered.length} cuotas · {activeGroups.length} grupos activos
            </p>

            {paymentMethods.length > 0 && (
              <div>
                <p
                  className="text-[10px] uppercase tracking-wide mb-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Medio de pago
                </p>
                <div className="flex flex-wrap gap-2">
                  {paymentMethods.length > 1 && (
                    <button
                      onClick={() => setPaymentFilter(null)}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-all"
                      style={{
                        backgroundColor: !paymentFilter ? "var(--color-primary)" : "transparent",
                        color: !paymentFilter ? "var(--color-on-primary)" : "var(--text-secondary)",
                        borderColor: !paymentFilter
                          ? "var(--color-primary)"
                          : "var(--border-color)",
                      }}
                    >
                      Todos
                    </button>
                  )}
                  {paymentMethods.map((pm) => (
                    <button
                      key={pm}
                      onClick={() => setPaymentFilter(paymentFilter === pm ? null : pm)}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-all"
                      style={{
                        backgroundColor:
                          paymentFilter === pm ? "var(--color-primary)" : "transparent",
                        color:
                          paymentFilter === pm
                            ? "var(--color-on-primary)"
                            : "var(--text-secondary)",
                        borderColor:
                          paymentFilter === pm ? "var(--color-primary)" : "var(--border-color)",
                      }}
                    >
                      {pm}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {categories.length > 0 && (
              <div>
                <p
                  className="text-[10px] uppercase tracking-wide mb-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Categoría
                </p>
                <div className="flex flex-wrap gap-2">
                  {categories.length > 1 && (
                    <button
                      onClick={() => setCategoryFilter(null)}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-all"
                      style={{
                        backgroundColor: !categoryFilter ? "var(--color-primary)" : "transparent",
                        color: !categoryFilter
                          ? "var(--color-on-primary)"
                          : "var(--text-secondary)",
                        borderColor: !categoryFilter
                          ? "var(--color-primary)"
                          : "var(--border-color)",
                      }}
                    >
                      Todas
                    </button>
                  )}
                  {categories.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-all"
                      style={{
                        backgroundColor:
                          categoryFilter === c ? "var(--color-primary)" : "transparent",
                        color:
                          categoryFilter === c
                            ? "var(--color-on-primary)"
                            : "var(--text-secondary)",
                        borderColor:
                          categoryFilter === c ? "var(--color-primary)" : "var(--border-color)",
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {persons.length > 1 && (
              <div>
                <p
                  className="text-[10px] uppercase tracking-wide mb-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Persona
                </p>
                <div className="flex flex-wrap gap-2">
                  {persons.length > 1 && (
                    <button
                      onClick={() => setPersonFilter(null)}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-all"
                      style={{
                        backgroundColor: !personFilter ? "var(--color-primary)" : "transparent",
                        color: !personFilter ? "var(--color-on-primary)" : "var(--text-secondary)",
                        borderColor: !personFilter ? "var(--color-primary)" : "var(--border-color)",
                      }}
                    >
                      Todas
                    </button>
                  )}
                  {persons.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPersonFilter(personFilter === p ? null : p)}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-all"
                      style={{
                        backgroundColor:
                          personFilter === p ? "var(--color-primary)" : "transparent",
                        color:
                          personFilter === p ? "var(--color-on-primary)" : "var(--text-secondary)",
                        borderColor:
                          personFilter === p ? "var(--color-primary)" : "var(--border-color)",
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showScheduledModal && selectedGroup && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-modal-backdrop"
          onClick={() => setShowScheduledModal(false)}
        >
          <div
            className="bg-[var(--color-surface)] border rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-xl animate-modal-content"
            style={{ borderColor: "var(--border-color)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between mb-4 pb-3 border-b"
              style={{ borderColor: "var(--border-color)" }}
            >
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                Cuotas Programadas: {toUpperCase(selectedGroup.description)}
              </h2>
              <button
                onClick={() => setShowScheduledModal(false)}
                className="text-lg leading-none transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              {scheduledLoading ? (
                <div className="space-y-2 py-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-16 rounded-lg bg-[var(--color-base-alt)] animate-pulse"
                    />
                  ))}
                </div>
              ) : scheduledForGroup.length === 0 ? (
                <p className="text-sm text-center py-4" style={{ color: "var(--text-secondary)" }}>
                  No hay cuotas programadas
                </p>
              ) : (
                scheduledForGroup.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3 rounded-lg transition-colors hover:bg-[var(--color-base-alt)] cursor-pointer"
                  >
                    <div>
                      <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                        Cuota {s.installment_number}/{s.installment_total}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                        {formatDateDMY(s.scheduled_date)} · {formatCurrency(s.amount, s.currency)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => executeMutation.mutate(s.id)}
                        className="px-3 py-1.5 text-xs rounded-lg transition-all bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-110 active:scale-95"
                        disabled={executeMutation.isPending}
                      >
                        Ejecutar ahora
                      </button>
                      <button
                        onClick={() => setCancelConfirm(s.id)}
                        className="px-3 py-1.5 text-xs rounded-lg border transition-colors border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
                        disabled={cancelMutation.isPending}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={cancelConfirm !== null}
        title="Cancelar cuota programada"
        message="¿Estás seguro que querés cancelar esta cuota? Esta acción no se puede deshacer."
        confirmLabel="Cancelar cuota"
        cancelLabel="Volver"
        variant="danger"
        onConfirm={() => {
          if (cancelConfirm !== null) {
            cancelMutation.mutate(cancelConfirm);
            setCancelConfirm(null);
          }
        }}
        onCancel={() => setCancelConfirm(null)}
      />

      {editing !== undefined && (
        <ExpenseModal
          initial={editing}
          mode="installments-only"
          onClose={() => {
            setEditing(undefined);
            setSaveError(null);
          }}
          onSave={(data) => createMut.mutate(data)}
          saveError={saveError}
          isSaving={createMut.isPending}
        />
      )}
    </div>
  );
}
