import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getBudgetSummary,
  getBudgetGroups,
  getBudgets,
  getBudgetEvents,
  getBudgetSuggestions,
  createBudgetEvent,
  deleteBudgetEvent,
  initBudgetGroups,
} from "../api/client";
import { Select } from "../components/ui/Select";
import type { BudgetGroup, BudgetEvent, BudgetSuggestion, BudgetSummaryItem } from "../types";
import { formatCurrency } from "../utils/format";

// ─── Donut Circle (50/30/20) ───────────────────────────────────

function DonutCircle({
  group,
  color,
  selected,
  onSelect,
  onEdit,
}: {
  group: BudgetGroup;
  color: string;
  selected: boolean;
  onSelect: () => void;
  onEdit: (g: BudgetGroup) => void;
}) {
  const pct = group.amount > 0 ? (group.spent / group.amount) * 100 : 0;
  const circumference = 2 * Math.PI * 14;
  const dashOffset = circumference - (Math.min(pct, 100) / 100) * circumference;

  return (
    <div
      className={`card p-5 flex flex-col items-center cursor-pointer transition-all ${selected ? "ring-2 ring-[var(--color-primary)] shadow-md" : "hover:shadow-md"}`}
      onClick={onSelect}
    >
      <div className="relative w-28 h-28 mb-3">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle
            cx="18"
            cy="18"
            r="14"
            fill="none"
            stroke="var(--color-base-alt)"
            strokeWidth="4"
          />
          <circle
            cx="18"
            cy="18"
            r="14"
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-bold" style={{ color }}>
            {Math.round(pct)}%
          </span>
        </div>
      </div>
      <h3 className="text-sm font-semibold text-primary mb-1">{group.display_name}</h3>
      <p className="text-xs text-[var(--text-secondary)]">
        {formatCurrency(group.amount - group.spent)} rest. de {formatCurrency(group.amount)}
      </p>
      <div className="flex gap-4 mt-2 text-[10px] text-[var(--text-tertiary)]">
        <span>Comprometido: {formatCurrency(group.committed)}</span>
        <span>
          Disponible:{" "}
          <span
            className={
              group.available < 0 ? "text-[var(--color-error)]" : "text-[var(--color-success)]"
            }
          >
            {formatCurrency(group.available)}
          </span>
        </span>
      </div>
      <button
        onClick={() => onEdit(group)}
        className="mt-3 flex items-center gap-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 rounded-lg px-3 py-1.5 transition-colors"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
        Editar
      </button>
    </div>
  );
}

// ─── Category Bar with Gradient ────────────────────────────────

function CategoryBar({
  name,
  color,
  spent,
  budget,
  avgMonthly = 0,
  onAddBudget,
}: {
  name: string;
  color: string;
  spent: number;
  budget: number;
  avgMonthly?: number;
  onAddBudget?: () => void;
}) {
  if (budget === 0 && spent === 0) return null;
  if (spent === 0) return null;

  // Calculate remaining and percentage
  const remaining = budget > 0 ? budget - spent : 0;
  const pct = budget > 0 ? (spent / budget) * 100 : 0;

  // Status badge logic
  let statusBadge: { label: string; color: string; bg: string } | null = null;
  if (budget > 0) {
    if (pct >= 100) {
      statusBadge = { label: "Alerta", color: "var(--color-danger)", bg: "var(--color-danger)/10" };
    } else if (pct >= 80) {
      statusBadge = { label: "Cuidado", color: "#e8a100", bg: "#e8a100/10" };
    } else {
      statusBadge = { label: "Bien", color: "var(--color-success)", bg: "var(--color-success)/10" };
    }
  }

  // Bar color — gradient based on percentage
  const barColor =
    pct >= 100
      ? "var(--color-danger)"
      : pct >= 80
        ? "#e8a100"
        : pct >= 60
          ? "var(--gnome-yellow-4)"
          : "var(--color-success)";

  // No budget case — use avg monthly as reference
  if (budget === 0) {
    const refAmount = avgMonthly > 0 ? avgMonthly : spent;
    const noBudgetPct = refAmount > 0 ? (spent / refAmount) * 100 : 0;
    const noBudgetBarColor =
      noBudgetPct >= 100
        ? "var(--color-danger)"
        : noBudgetPct >= 80
          ? "#e8a100"
          : noBudgetPct >= 60
            ? "var(--gnome-yellow-4)"
            : "var(--color-success)";

    return (
      <div className="py-3 px-4 rounded-lg hover:bg-[var(--color-base-alt)] transition-colors">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-sm font-medium text-[var(--text-primary)]">{name}</span>
          </div>
          <span className="text-xs text-[var(--text-tertiary)] italic">Sin presupuesto</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(noBudgetPct, 100)}%`, backgroundColor: noBudgetBarColor }}
            />
          </div>
          <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap font-medium">
            {formatCurrency(spent)}
            {avgMonthly > 0 && (
              <span className="text-[var(--text-tertiary)] font-normal">
                {" "}
                / prom {formatCurrency(avgMonthly)}
              </span>
            )}
          </span>
        </div>
        {onAddBudget && (
          <button
            onClick={onAddBudget}
            className="mt-1.5 text-xs text-[var(--color-primary)] hover:underline"
          >
            + Agregar presupuesto
          </button>
        )}
      </div>
    );
  }

  // With budget — show remaining prominently
  return (
    <div className="py-3 px-4 rounded-lg hover:bg-[var(--color-base-alt)] transition-colors">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <span className="text-sm font-medium text-[var(--text-primary)]">{name}</span>
        </div>
        {statusBadge && (
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{
              color: statusBadge.color,
              backgroundColor: `color-mix(in srgb, ${statusBadge.color} 10%, transparent)`,
            }}
          >
            {pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢"} {statusBadge.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }}
          />
        </div>
        <span
          className={`text-xs font-semibold whitespace-nowrap ${remaining < 0 ? "text-[var(--color-danger)]" : "text-[var(--text-primary)]"}`}
        >
          {remaining >= 0
            ? `${formatCurrency(remaining)} rest.`
            : `-${formatCurrency(Math.abs(remaining))}`}
        </span>
        <span className="text-xs text-[var(--text-tertiary)] whitespace-nowrap">
          {Math.round(pct)}%
        </span>
      </div>
    </div>
  );
}

// ─── Category Group Section ────────────────────────────────────

function CategoryGroupSection({
  displayName,
  color,
  categories,
  onAddBudget,
}: {
  name: string;
  displayName: string;
  color: string;
  categories: BudgetSummaryItem[];
  onAddBudget: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const totalBudget = categories.reduce((s, c) => s + c.budget_amount, 0);
  const totalSpent = categories.reduce((s, c) => s + c.spent_amount, 0);
  const totalRemaining = totalBudget - totalSpent;

  const visibleCategories = categories.filter((c) => c.spent_amount > 0);
  if (visibleCategories.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--border-color)] overflow-hidden bg-[var(--color-surface)]">
      {/* Group Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--color-base-alt)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-3.5 h-3.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
          <h3 className="text-sm font-semibold text-primary">{displayName}</h3>
          <span className="text-xs text-[var(--text-tertiary)] bg-[var(--color-base-alt)] px-2 py-0.5 rounded-full">
            {visibleCategories.length} {visibleCategories.length === 1 ? "categoría" : "categorías"}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {totalBudget > 0 && (
            <span
              className={`text-xs font-semibold ${totalRemaining < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}
            >
              {totalRemaining >= 0
                ? `${formatCurrency(totalRemaining)} rest.`
                : `-${formatCurrency(Math.abs(totalRemaining))}`}
            </span>
          )}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`text-[var(--text-tertiary)] transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </button>

      {/* Categories List */}
      {expanded && (
        <div className="border-t border-[var(--border-color)] bg-[var(--color-base)]/50">
          {visibleCategories.map((cat) => (
            <div key={cat.category_id}>
              <CategoryBar
                name={cat.category_name}
                color={cat.category_color}
                spent={cat.spent_amount}
                budget={cat.budget_amount}
                avgMonthly={cat.avg_monthly}
                onAddBudget={onAddBudget}
              />
              {cat.children
                .filter((child) => child.spent_amount > 0)
                .map((child) => (
                  <div key={child.category_id} className="pl-6">
                    <CategoryBar
                      name={child.category_name}
                      color={child.category_color}
                      spent={child.spent_amount}
                      budget={child.budget_amount}
                      avgMonthly={child.avg_monthly}
                      onAddBudget={onAddBudget}
                    />
                  </div>
                ))}
            </div>
          ))}
          <div className="px-5 py-3 border-t border-[var(--border-color)]">
            <button
              onClick={onAddBudget}
              className="text-xs text-[var(--color-primary)] hover:underline font-medium"
            >
              + Agregar presupuesto
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Event Card ────────────────────────────────────────────────

function EventCard({ event, onDelete }: { event: BudgetEvent; onDelete: (id: number) => void }) {
  const pct = event.total_amount > 0 ? (event.spent / event.total_amount) * 100 : 0;
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(event.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  return (
    <div className="card p-4 flex items-center gap-4">
      <div className="flex-1">
        <h4 className="text-sm font-semibold text-primary">{event.name}</h4>
        <p className="text-xs text-[var(--text-tertiary)]">
          {event.start_date} — {event.end_date}
        </p>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          {formatCurrency(event.spent)} / {formatCurrency(event.total_amount)}
        </p>
        <div className="mt-2 h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden max-w-[200px]">
          <div
            className="h-full rounded-full bg-[var(--color-primary)] transition-all"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs text-[var(--text-tertiary)]">{daysLeft} días</p>
        <p className="text-sm font-bold text-primary">{Math.round(pct)}%</p>
      </div>
      <button
        onClick={() => onDelete(event.id)}
        className="text-[var(--text-tertiary)] hover:text-[var(--color-error)] text-lg"
      >
        ×
      </button>
    </div>
  );
}

// ─── Suggestions Banner ────────────────────────────────────────

function SuggestionsBanner({ suggestions }: { suggestions: BudgetSuggestion[] }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  const applyMutation = useMutation({
    mutationFn: async (s: BudgetSuggestion) => {
      const { createBudget } = await import("../api/client");
      return createBudget({ category_id: s.category_id, amount: s.suggested });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["budget-summary"] });
      qc.invalidateQueries({ queryKey: ["budget-suggestions"] });
    },
  });

  if (suggestions.length === 0) return null;

  return (
    <div className="card p-4 border-l-4 border-[var(--color-primary)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">💡</span>
          <span className="text-sm font-semibold text-primary">
            Sugerencias basadas en tus últimos 3 meses
          </span>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-[var(--text-tertiary)] transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-3 space-y-2">
          {suggestions
            .filter((s) => !s.has_budget)
            .map((s) => (
              <div
                key={s.category_id}
                className="flex items-center justify-between py-2 border-t border-[var(--border-color)]"
              >
                <div>
                  <span className="text-xs font-medium text-primary">{s.category_name}</span>
                  <span className="text-xs text-[var(--text-tertiary)] ml-2">
                    prom: {formatCurrency(s.avg_monthly)}/mes
                  </span>
                </div>
                <button
                  onClick={() => applyMutation.mutate(s)}
                  className="text-xs text-[var(--color-primary)] hover:underline font-medium"
                >
                  Sugerir {formatCurrency(s.suggested)}
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Quick Config Modal ────────────────────────────────────────

function QuickConfigModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: budgets = [] } = useQuery({
    queryKey: ["budgets"],
    queryFn: () => import("../api/client").then((m) => m.getBudgets()),
  });
  const { data: summary } = useQuery({
    queryKey: ["budget-summary"],
    queryFn: () => import("../api/client").then((m) => m.getBudgetSummary()),
  });

  // Build set of category IDs that already have budgets
  const budgetedCatIds = new Set(budgets.map((b) => b.category_id));

  // Get categories with spending but no budget (use summary directly — it includes all categories with spending)
  const unbudgetedCategories =
    summary?.categories.filter(
      (c) => c.category_id !== null && c.spent_amount > 0 && !budgetedCatIds.has(c.category_id),
    ) ?? [];

  const [amounts, setAmounts] = useState<Record<number, number>>({});
  const [groupAssignments, setGroupAssignments] = useState<Record<number, string>>({});

  useState(() => {
    const initial: Record<number, number> = {};
    for (const b of budgets) initial[b.category_id] = b.amount;
    setAmounts(initial);
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { createBudget, updateCategoryGroup } = await import("../api/client");
      const promises = [];
      for (const [catId, amount] of Object.entries(amounts)) {
        if (amount > 0) {
          promises.push(createBudget({ category_id: parseInt(catId), amount }));
        }
      }
      for (const [catId, group] of Object.entries(groupAssignments)) {
        if (group) {
          promises.push(updateCategoryGroup(parseInt(catId), group));
        }
      }
      return Promise.all(promises);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["budget-summary"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-primary mb-2">Configurar Presupuestos</h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          {unbudgetedCategories.length} categorías con gastos sin presupuesto asignado
        </p>
        {unbudgetedCategories.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-[var(--text-secondary)]">
              Todas las categorías ya tienen presupuesto
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {unbudgetedCategories.map((cat) => (
              <div
                key={cat.category_id}
                className="flex items-center gap-3 py-2 border-b border-[var(--border-color)]"
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: cat.category_color }}
                />
                <span className="text-xs font-medium text-primary min-w-[100px] truncate">
                  {cat.category_name}
                </span>
                <Select
                  value={groupAssignments[cat.category_id!] || ""}
                  onChange={(v) =>
                    setGroupAssignments({ ...groupAssignments, [cat.category_id!]: v })
                  }
                  options={[
                    { value: "", label: "Sin grupo" },
                    { value: "necesidades", label: "Necesidades" },
                    { value: "gustos", label: "Gustos" },
                    { value: "ahorro", label: "Ahorro" },
                  ]}
                />
                <input
                  type="number"
                  value={amounts[cat.category_id!] || ""}
                  onChange={(e) =>
                    setAmounts({ ...amounts, [cat.category_id!]: parseFloat(e.target.value) || 0 })
                  }
                  placeholder="0"
                  className="input flex-1 !py-1.5"
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
          >
            Cancelar
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || Object.values(amounts).every((v) => !v)}
            className="flex-1 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveMutation.isPending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Group Modal ──────────────────────────────────────────

function EditGroupModal({ group, onClose }: { group: BudgetGroup; onClose: () => void }) {
  const qc = useQueryClient();
  const [percentage, setPercentage] = useState(group.percentage);
  const [amount, setAmount] = useState(group.amount);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { updateBudgetGroup } = await import("../api/client");
      return updateBudgetGroup(group.id, { percentage, amount });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget-groups"] });
      qc.invalidateQueries({ queryKey: ["budget-summary"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <h3 className="text-base font-semibold text-primary mb-4">Editar — {group.display_name}</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Porcentaje del ingreso
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={percentage}
                onChange={(e) => {
                  const p = parseFloat(e.target.value) || 0;
                  setPercentage(p);
                  const total = amount / (group.percentage / 100);
                  setAmount(Math.round((total * p) / 100));
                }}
                min="0"
                max="100"
                className="input w-24"
              />
              <span className="text-sm text-[var(--text-secondary)]">%</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Monto mensual
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
              className="input w-full"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
          >
            Cancelar
          </button>
          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="flex-1 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {updateMutation.isPending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New Event Modal ───────────────────────────────────────────

function NewEventModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [totalAmount, setTotalAmount] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      createBudgetEvent({
        name,
        start_date: startDate,
        end_date: endDate,
        total_amount: parseFloat(totalAmount),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget-events"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <h3 className="text-base font-semibold text-primary mb-4">Nuevo Evento Temporal</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Nombre
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Vacaciones"
              className="input w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Inicio
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Fin
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input w-full"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Presupuesto total
            </label>
            <input
              type="number"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              className="input w-full"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
          >
            Cancelar
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!name || !startDate || !endDate || !totalAmount || createMutation.isPending}
            className="flex-1 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {createMutation.isPending ? "Creando..." : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main BudgetPage ───────────────────────────────────────────

export default function BudgetPage() {
  const qc = useQueryClient();
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [showQuickConfig, setShowQuickConfig] = useState(false);
  const [editingGroup, setEditingGroup] = useState<BudgetGroup | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ["budget-summary"],
    queryFn: () => getBudgetSummary(),
  });

  const { data: groups = [], isLoading: loadingGroups } = useQuery({
    queryKey: ["budget-groups"],
    queryFn: getBudgetGroups,
  });

  const { data: events = [], isLoading: loadingEvents } = useQuery({
    queryKey: ["budget-events"],
    queryFn: getBudgetEvents,
  });

  const { data: suggestionsData } = useQuery({
    queryKey: ["budget-suggestions"],
    queryFn: getBudgetSuggestions,
  });

  const { data: allBudgets = [] } = useQuery({
    queryKey: ["budgets"],
    queryFn: getBudgets,
  });

  const initGroupsMutation = useMutation({
    mutationFn: (income: number) => initBudgetGroups(income),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget-groups"] }),
  });

  const deleteEventMutation = useMutation({
    mutationFn: deleteBudgetEvent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget-events"] }),
  });

  const [incomeInput, setIncomeInput] = useState("");

  const handleInitGroups = () => {
    const income = parseFloat(incomeInput);
    if (income > 0) initGroupsMutation.mutate(income);
  };

  const isLoading = loadingSummary || loadingGroups || loadingEvents;

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-[var(--color-base-alt)] rounded w-48" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-[var(--color-base-alt)] rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 bg-[var(--color-base-alt)] rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Compute KPIs
  const totalBudget = groups.reduce((s, g) => s + g.amount, 0);
  const totalSpent = groups.reduce((s, g) => s + g.spent, 0);
  const totalAvailable = totalBudget - totalSpent;

  // Count categories with spending but no budget (using summary directly — it already includes all categories with spending)
  const budgetedCatIds = new Set(allBudgets.map((b) => b.category_id));
  const unbudgetedCount =
    summary?.categories.filter(
      (c) => c.category_id !== null && c.spent_amount > 0 && !budgetedCatIds.has(c.category_id),
    ).length ?? 0;

  // Group categories by macro group
  const groupColors: Record<string, string> = {
    necesidades: "var(--color-primary)",
    gustos: "var(--color-warning)",
    ahorro: "var(--color-success)",
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">Presupuesto</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Gestioná tus límites de gasto por categoría
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowNewEvent(true)}
            className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90"
          >
            + Nuevo Evento
          </button>
        </div>
      </div>

      {/* 50/30/20 Groups or Init */}
      {groups.length > 0 ? (
        <>
          {/* KPI Row */}
          <div
            className={`grid gap-4 mb-6 ${unbudgetedCount > 0 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-1 sm:grid-cols-3"}`}
          >
            <div className="card p-4">
              <p className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1">
                Presupuestado
              </p>
              <p className="text-lg font-bold text-primary">{formatCurrency(totalBudget)}</p>
            </div>
            <div className="card p-4">
              <p className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1">Gastado</p>
              <p className="text-lg font-bold text-primary">{formatCurrency(totalSpent)}</p>
            </div>
            <div className="card p-4">
              <p className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1">Quedan</p>
              <p
                className={`text-lg font-bold ${totalAvailable < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}
              >
                {formatCurrency(totalAvailable)}
              </p>
            </div>
            {unbudgetedCount > 0 && (
              <div
                className="card p-4 cursor-pointer hover:bg-[var(--color-base-alt)] transition-colors"
                onClick={() => setShowQuickConfig(true)}
              >
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1">
                  Sin presupuesto
                </p>
                <p className="text-lg font-bold text-[var(--color-primary)]">{unbudgetedCount}</p>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                  categorías → configurar
                </p>
              </div>
            )}
          </div>

          {/* 50/30/20 Donuts */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
              Distribución del presupuesto
            </h2>
            <div className={`grid grid-cols-1 sm:grid-cols-${groups.length} gap-4`}>
              {groups.map((g) => (
                <DonutCircle
                  key={g.id}
                  group={g}
                  color={groupColors[g.name] || "var(--color-primary)"}
                  selected={selectedGroup === g.name}
                  onSelect={() => setSelectedGroup(selectedGroup === g.name ? null : g.name)}
                  onEdit={setEditingGroup}
                />
              ))}
            </div>
          </div>

          {/* Category Groups */}
          <div className="mb-6 space-y-4">
            {summary && summary.categories.length > 0 ? (
              <>
                {selectedGroup ? (
                  <CategoryGroupSection
                    name={selectedGroup}
                    displayName={
                      selectedGroup === "necesidades"
                        ? "Necesidades"
                        : selectedGroup === "gustos"
                          ? "Gustos"
                          : "Ahorro"
                    }
                    color={groupColors[selectedGroup] || "var(--color-primary)"}
                    categories={summary.categories.filter((c) => c.budget_group === selectedGroup)}
                    onAddBudget={() => setShowQuickConfig(true)}
                  />
                ) : (
                  groups.map((g) => (
                    <CategoryGroupSection
                      key={g.name}
                      name={g.name}
                      displayName={g.display_name}
                      color={groupColors[g.name] || "var(--color-primary)"}
                      categories={summary.categories.filter((c) => c.budget_group === g.name)}
                      onAddBudget={() => setShowQuickConfig(true)}
                    />
                  ))
                )}
              </>
            ) : (
              <div className="card p-8 text-center">
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  No hay presupuestos configurados
                </p>
                <button
                  onClick={() => setShowQuickConfig(true)}
                  className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90"
                >
                  + Agregar primer presupuesto
                </button>
              </div>
            )}
          </div>

          {/* Events — full width */}
          {events.length > 0 && (
            <div className="card p-5 mb-6">
              <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
                Eventos Temporales
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onDelete={(id) => deleteEventMutation.mutate(id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* Init Screen */
        <div className="card p-8 mb-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center mx-auto mb-4">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-9-9" />
                <path d="M21 3v9h-9" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-primary mb-2">
              Empezá a controlar tu presupuesto
            </h3>
            <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto">
              Definí cuánto querés gastar en cada categoría y la app te avisa cuando te acercás al
              límite.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-xl border border-[var(--border-color)] text-center">
              <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center mx-auto mb-2">
                <span className="text-[var(--color-primary)] font-bold">50%</span>
              </div>
              <p className="text-sm font-semibold text-primary">Necesidades</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Alimentación, Transporte, Salud, Hogar
              </p>
            </div>
            <div className="p-4 rounded-xl border border-[var(--border-color)] text-center">
              <div className="w-10 h-10 rounded-full bg-[var(--color-warning)]/10 flex items-center justify-center mx-auto mb-2">
                <span className="text-[var(--color-warning)] font-bold">30%</span>
              </div>
              <p className="text-sm font-semibold text-primary">Gustos</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Entretenimiento, Salidas, Ropa
              </p>
            </div>
            <div className="p-4 rounded-xl border border-[var(--border-color)] text-center">
              <div className="w-10 h-10 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center mx-auto mb-2">
                <span className="text-[var(--color-success)] font-bold">20%</span>
              </div>
              <p className="text-sm font-semibold text-primary">Ahorro</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">Inversiones, Ahorro</p>
            </div>
          </div>
          <div className="max-w-lg mx-auto">
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2 text-center">
              ¿Cuánto ganás por mes?
            </label>
            <div className="flex items-center gap-2">
              <span className="text-lg text-[var(--text-secondary)]">$</span>
              <input
                type="number"
                value={incomeInput}
                onChange={(e) => setIncomeInput(e.target.value)}
                placeholder="500,000"
                className="input flex-1 text-lg py-3"
              />
            </div>
            <button
              onClick={handleInitGroups}
              disabled={!incomeInput || initGroupsMutation.isPending}
              className="w-full mt-4 px-4 py-3 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {initGroupsMutation.isPending ? "Creando..." : "Crear mi presupuesto"}
            </button>
          </div>
        </div>
      )}

      {/* Suggestions */}
      {suggestionsData && suggestionsData.suggestions.length > 0 && (
        <SuggestionsBanner suggestions={suggestionsData.suggestions} />
      )}

      {/* Modals */}
      {showNewEvent && <NewEventModal onClose={() => setShowNewEvent(false)} />}
      {showQuickConfig && <QuickConfigModal onClose={() => setShowQuickConfig(false)} />}
      {editingGroup && (
        <EditGroupModal group={editingGroup} onClose={() => setEditingGroup(null)} />
      )}
    </div>
  );
}
