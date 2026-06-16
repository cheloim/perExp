import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  getInstallmentsDashboard,
  getInstallmentsMonthlyLoad,
  getScheduledExpenses,
  executeScheduledExpense,
  cancelScheduledExpense,
} from "../api/client";
import type { InstallmentGroup } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { formatCurrency, toUpperCase, formatDateDMY } from "../utils/format";

const MONTHS_ES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

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
    <svg width="38" height="14" viewBox="0 0 52 18" fill="none">
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
    <svg width="32" height="22" viewBox="0 0 42 28" fill="none">
      <circle cx="15" cy="14" r="13" fill="#EB001B" />
      <circle cx="27" cy="14" r="13" fill="#F79E1B" fillOpacity="0.92" />
    </svg>
  );
}

function AmexLogo() {
  return (
    <svg width="38" height="18" viewBox="0 0 46 22" fill="none">
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

const CARD_GRADIENTS = [
  "from-[#3584e4] to-[#1c71d8]",
  "from-[#26a269] to-[#1b7f3e]",
  "from-[#c64600] to-[#a35100]",
  "from-[#9141ac] to-[#613583]",
  "from-[#62a0ea] to-[#3584e4]",
  "from-[#e5a50a] to-[#b78c09]",
];

interface CardEntry {
  key: string;
  card_id: number | null;
  bank: string;
  person: string;
  pendingTotal: number;
  currency: string;
}

function InstallmentCard({
  entry,
  active,
  onClick,
  index,
}: {
  entry: CardEntry;
  active: boolean;
  onClick: () => void;
  index: number;
}) {
  const network = detectNetwork(entry.bank);
  const color = CARD_GRADIENTS[index % CARD_GRADIENTS.length];

  return (
    <div
      onClick={onClick}
      className={`relative rounded-xl p-4 bg-gradient-to-br ${color} cursor-pointer transition-all duration-200 hover:scale-[1.02] shadow-md ${
        active ? "ring-2 ring-white/60 scale-[1.02]" : "opacity-90 hover:opacity-100"
      }`}
      style={{ minWidth: 200, maxWidth: 280, minHeight: 120 }}
    >
      <div className="flex justify-between items-start">
        <div className="min-w-0 flex-1">
          <p className="text-white/70 text-[11px] font-medium tracking-widest uppercase truncate">
            {entry.bank || "Banco"}
          </p>
          <p className="text-white text-sm font-semibold tracking-wide truncate">{entry.bank}</p>
        </div>
        <div className="flex-shrink-0 ml-2">
          <CardNetworkLogo network={network} />
        </div>
      </div>

      <div className="mt-3 mb-1 w-6 h-4 rounded-sm bg-yellow-300/80 border border-yellow-400/60 flex items-center justify-center">
        <div className="w-4 h-2.5 rounded-sm border border-yellow-500/50 grid grid-cols-2 gap-px p-px">
          <div className="bg-yellow-500/30 rounded-sm" />
          <div className="bg-yellow-500/30 rounded-sm" />
          <div className="bg-yellow-500/30 rounded-sm" />
          <div className="bg-yellow-500/30 rounded-sm" />
        </div>
      </div>

      <p className="text-white/60 text-[10px] mt-1">Cuotas pendientes</p>
      <p className="text-white font-bold text-lg leading-tight">
        {formatCurrency(entry.pendingTotal, entry.currency)}
      </p>
    </div>
  );
}

export default function InstallmentsPage() {
  const queryClient = useQueryClient();
  const [bankFilter, setBankFilter] = useState<string | null>(null);
  const [activeCardKey, setActiveCardKey] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<InstallmentGroup | null>(null);
  const [showScheduledModal, setShowScheduledModal] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState<number | null>(null);

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

  const { data: scheduledForGroup = [] } = useQuery({
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

  const cardMap = new Map<string, CardEntry>();
  for (const g of activeGroups) {
    const key = g.card_id ? `card_${g.card_id}` : `bank_person_${g.bank}|${g.person}`;
    if (!cardMap.has(key)) {
      cardMap.set(key, {
        key,
        card_id: g.card_id,
        bank: g.bank,
        person: g.person,
        pendingTotal: 0,
        currency: g.currency,
      });
    }
    cardMap.get(key)!.pendingTotal += g.installment_amount * g.remaining_installments;
  }
  const cardEntries = Array.from(cardMap.values());

  const banks = [...new Set(groups.map((g) => g.bank).filter(Boolean))].sort();

  const activeCard = activeCardKey ? cardEntries.find((c) => c.key === activeCardKey) : null;

  const filtered = groups.filter((g) => {
    if (!showCompleted && g.remaining_installments === 0) return false;
    if (bankFilter && g.bank !== bankFilter) return false;
    if (activeCard) {
      const groupKey = g.card_id ? `card_${g.card_id}` : `bank_person_${g.bank}|${g.person}`;
      if (groupKey !== activeCard.key) return false;
    }
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
    <div className="space-y-6 p-4 md:p-6">
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
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={monthlyLoad} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--chart-grid)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: "var(--chart-text)" }}
                      tickFormatter={(v: string) => {
                        const [y, m] = v.split("-");
                        return `${MONTHS_ES[parseInt(m) - 1]} ${y.slice(2)}`;
                      }}
                    />
                    <YAxis
                      tickFormatter={(v) =>
                        new Intl.NumberFormat("es-AR", { notation: "compact" } as any).format(v)
                      }
                      tick={{ fontSize: 11, fill: "var(--chart-text)" }}
                      width={52}
                    />
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
                        return `${MONTHS_ES[parseInt(m) - 1]} ${y}`;
                      }}
                    />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                      {monthlyLoad.map((e) => {
                        let fill = "var(--color-primary)";
                        if (e.is_current) fill = "var(--color-success)";
                        else if (e.is_past) fill = "var(--gnome-yellow-3)";
                        else if (currentTotal > 0)
                          fill =
                            e.total > currentTotal ? "var(--color-danger)" : "var(--color-primary)";
                        return (
                          <Cell key={e.month} fill={fill} fillOpacity={e.is_past ? 0.75 : 1} />
                        );
                      })}
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
                              className="text-xs underline transition-colors"
                              style={{ color: "var(--text-secondary)" }}
                              onMouseEnter={(e) =>
                                (e.currentTarget.style.color = "var(--text-primary)")
                              }
                              onMouseLeave={(e) =>
                                (e.currentTarget.style.color = "var(--text-secondary)")
                              }
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
                Tarjetas
              </h2>
              {(bankFilter || activeCardKey) && (
                <button
                  onClick={() => {
                    setBankFilter(null);
                    setActiveCardKey(null);
                  }}
                  className="text-xs transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                >
                  Limpiar
                </button>
              )}
            </div>

            {banks.length > 1 && (
              <div>
                <p
                  className="text-[10px] uppercase tracking-wide mb-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Banco
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setBankFilter(null)}
                    className="text-xs px-3 py-1.5 rounded-lg border transition-all"
                    style={{
                      backgroundColor: !bankFilter ? "var(--color-primary)" : "transparent",
                      color: !bankFilter ? "var(--color-on-primary)" : "var(--text-secondary)",
                      borderColor: !bankFilter ? "var(--color-primary)" : "var(--border-color)",
                    }}
                  >
                    Todos
                  </button>
                  {banks.map((b) => (
                    <button
                      key={b}
                      onClick={() => setBankFilter(bankFilter === b ? null : b)}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-all"
                      style={{
                        backgroundColor: bankFilter === b ? "var(--color-primary)" : "transparent",
                        color:
                          bankFilter === b ? "var(--color-on-primary)" : "var(--text-secondary)",
                        borderColor:
                          bankFilter === b ? "var(--color-primary)" : "var(--border-color)",
                      }}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
              {cardEntries
                .filter((c) => !bankFilter || c.bank === bankFilter)
                .map((entry, idx) => (
                  <InstallmentCard
                    key={entry.key}
                    entry={entry}
                    active={activeCardKey === entry.key}
                    onClick={() => setActiveCardKey(activeCardKey === entry.key ? null : entry.key)}
                    index={idx}
                  />
                ))}
            </div>
          </div>
        </div>
      </div>

      {showScheduledModal && selectedGroup && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowScheduledModal(false)}
        >
          <div
            className="bg-[var(--color-surface)] border rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-xl"
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
                className="text-lg leading-none transition-colors"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              {scheduledForGroup.length === 0 ? (
                <p className="text-sm text-center py-4" style={{ color: "var(--text-secondary)" }}>
                  No hay cuotas programadas
                </p>
              ) : (
                scheduledForGroup.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3 rounded-lg transition-colors"
                    style={{ backgroundColor: "transparent" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "var(--color-base-alt)")
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
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
                        className="px-3 py-1.5 text-xs rounded-lg transition-all"
                        style={{
                          backgroundColor: "var(--color-primary)",
                          color: "var(--color-on-primary)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.1)")}
                        onMouseLeave={(e) => (e.currentTarget.style.filter = "brightness(1)")}
                        disabled={executeMutation.isPending}
                      >
                        Ejecutar ahora
                      </button>
                      <button
                        onClick={() => setCancelConfirm(s.id)}
                        className="px-3 py-1.5 text-xs rounded-lg border transition-colors"
                        style={{
                          borderColor: "var(--border-color)",
                          color: "var(--text-secondary)",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor = "var(--color-base-alt)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = "transparent")
                        }
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
    </div>
  );
}
