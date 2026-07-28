import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRecurringExpenses, pauseRecurringExpense, deleteRecurringExpense } from "../api/client";
import type { RecurringExpense } from "../api/client";
import { formatCurrency, formatDateDMY } from "../utils/format";
import EmptyState from "../components/ui/EmptyState";

type Tab = "cuotas" | "recurrentes" | "manuales";

function RecurringIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("netflix") || lower.includes("spotify") || lower.includes("hbo")) return "📺";
  if (lower.includes("gym") || lower.includes("fitness")) return "💪";
  if (lower.includes("internet") || lower.includes("wifi")) return "🌐";
  if (lower.includes("seguro") || lower.includes("insurance")) return "🛡️";
  return "🔄";
}

export default function GastosProgramadosPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("recurrentes");
  const [showPaused, setShowPaused] = useState(false);

  const { data: recurring = [], isLoading } = useQuery({
    queryKey: ["recurring", showPaused ? "all" : "active"],
    queryFn: () => getRecurringExpenses(showPaused ? "all" : "active"),
  });

  const filteredRecurring = useMemo(() => {
    return recurring.filter((r) => (showPaused ? true : r.is_active));
  }, [recurring, showPaused]);

  const handlePause = async (id: number) => {
    await pauseRecurringExpense(id);
    queryClient.invalidateQueries({ queryKey: ["recurring"] });
  };

  const handleDelete = async (id: number) => {
    if (confirm("¿Eliminar esta suscripción permanentemente?")) {
      await deleteRecurringExpense(id);
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
    }
  };

  const totalMonthly = filteredRecurring
    .filter((r) => r.is_active)
    .reduce((sum, r) => sum + r.amount, 0);

  const tabs = [
    { key: "cuotas" as const, label: "Cuotas", icon: "🛒" },
    { key: "recurrentes" as const, label: "Recurrentes", icon: "🔄" },
    { key: "manuales" as const, label: "Manuales", icon: "📝" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-primary">Programados</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--color-base-alt)] p-1 rounded-lg">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-all ${
              tab === t.key
                ? "bg-[var(--color-surface)] text-primary shadow-sm"
                : "text-tertiary hover:text-primary"
            }`}
          >
            <span className="mr-1">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Toggle for showing paused */}
      {tab === "recurrentes" && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-tertiary">
            {filteredRecurring.length} suscripción{filteredRecurring.length !== 1 ? "es" : ""}
          </span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showPaused}
              onChange={(e) => setShowPaused(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--border-color)]"
            />
            <span className="text-xs text-tertiary">Mostrar pausadas</span>
          </label>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="card p-8 text-center text-tertiary">Cargando...</div>
      ) : tab === "recurrentes" && filteredRecurring.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="🔄"
            title="Sin gastos recurrentes"
            description="Los gastos que se repiten mensualmente aparecerán aquí automáticamente"
          />
        </div>
      ) : tab === "recurrentes" ? (
        <div className="space-y-2">
          {/* Total banner */}
          <div className="card p-3 flex items-center justify-between">
            <span className="text-sm font-medium text-primary">Total mensual</span>
            <span className="text-sm font-bold text-primary">{formatCurrency(totalMonthly)}</span>
          </div>

          {/* Recurring list */}
          {filteredRecurring.map((rec) => {
            const daysUntil = rec.next_charge_date
              ? Math.max(
                  0,
                  Math.ceil((new Date(rec.next_charge_date).getTime() - Date.now()) / 86400000),
                )
              : null;
            const isPaused = !rec.is_active;

            return (
              <div key={rec.id} className={`card p-4 ${isPaused ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-2xl">{RecurringIcon({ name: rec.description })}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-primary truncate">
                        {rec.description}
                      </p>
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
                      {isPaused && (
                        <span className="text-[10px] text-[var(--gnome-yellow-4)] font-medium">
                          PAUSADO
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handlePause(rec.id)}
                      className="p-1.5 rounded-md hover:bg-[var(--color-base-alt)] transition text-xs"
                      title={isPaused ? "Reanudar" : "Pausar"}
                    >
                      {isPaused ? "▶️" : "⏸️"}
                    </button>
                    <button
                      onClick={() => handleDelete(rec.id)}
                      className="p-1.5 rounded-md hover:bg-[var(--color-base-alt)] transition text-xs"
                      title="Eliminar"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            icon="📝"
            title={tab === "cuotas" ? "Sin gastos en cuotas" : "Sin gastos manuales programados"}
            description={
              tab === "cuotas"
                ? "Las cuotas de tus compras aparecerán aquí"
                : "Los gastos que programes manualmente aparecerán aquí"
            }
          />
        </div>
      )}
    </div>
  );
}
