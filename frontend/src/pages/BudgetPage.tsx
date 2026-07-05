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
import type { BudgetSummaryResponse, BudgetGroup, Budget, BudgetEvent, BudgetSuggestion } from "../types";
import { formatCurrency } from "../utils/format";

// ─── Budget Group Card (50/30/20) ─────────────────────────────

function BudgetGroupCard({
  group,
  onEdit,
}: {
  group: BudgetGroup;
  onEdit: (group: BudgetGroup) => void;
}) {
  const committedPct = group.amount > 0 ? (group.committed / group.amount) * 100 : 0;
  const spentPct = group.amount > 0 ? (group.spent / group.amount) * 100 : 0;
  const status = spentPct >= 100 ? "exceeded" : spentPct >= 80 ? "warning" : "ok";
  const committedStatus = committedPct > 100 ? "exceeded" : committedPct > 80 ? "warning" : "ok";

  const statusColors = {
    ok: "text-[var(--color-success)]",
    warning: "text-[var(--color-warning)]",
    exceeded: "text-[var(--color-error)]",
  };
  const barColors = {
    ok: "bg-[var(--color-success)]",
    warning: "bg-[var(--color-warning)]",
    exceeded: "bg-[var(--color-error)]",
  };

  const groupColors: Record<string, string> = {
    necesidades: "var(--color-primary)",
    gustos: "var(--color-warning)",
    ahorro: "var(--color-success)",
  };

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-primary">{group.display_name}</h3>
            <span
              className="text-xs font-medium"
              style={{ color: groupColors[group.name] || "var(--color-primary)" }}
            >
              {group.percentage}%
            </span>
          </div>
          <button
            onClick={() => onEdit(group)}
            className="text-xs text-[var(--text-tertiary)] hover:text-[var(--color-primary)]"
          >
            Editar
          </button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div>
            <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Asignado</p>
            <p className="text-sm font-bold text-primary">{formatCurrency(group.amount)}</p>
          </div>
          <div>
            <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Comprometido</p>
            <p className={`text-sm font-bold ${committedStatus === "exceeded" ? "text-[var(--color-error)]" : "text-primary"}`}>
              {formatCurrency(group.committed)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Disponible</p>
            <p className={`text-sm font-bold ${group.available < 0 ? "text-[var(--color-error)]" : "text-[var(--color-success)]"}`}>
              {formatCurrency(group.available)}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-3 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColors[status]}`}
            style={{ width: `${Math.min(spentPct, 100)}%` }}
          />
        </div>
        <p className="text-xs text-[var(--text-tertiary)] mt-1 text-center">
          {Math.round(spentPct)}% utilizado · {formatCurrency(group.spent)} / {formatCurrency(group.amount)}
        </p>

        {/* Committed warning */}
        {group.committed > group.amount && (
          <div className="mt-2 p-2 bg-[var(--color-error)]/10 rounded text-xs text-[var(--color-error)] text-center">
            ⚠️ Comprometido excede el presupuesto del grupo
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Budget Category Bar ──────────────────────────────────────

function BudgetCategoryBar({
  name,
  color,
  spent,
  budget,
  threshold,
}: {
  name: string;
  color: string;
  spent: number;
  budget: number;
  threshold: number;
}) {
  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  const status = pct >= 100 ? "exceeded" : pct >= threshold * 100 ? "warning" : "ok";
  const barColor = status === "exceeded" ? "var(--color-error)" : status === "warning" ? "var(--color-warning)" : color;

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="text-xs text-[var(--text-primary)] min-w-[100px] truncate font-medium">{name}</span>
      <div className="flex-1 h-3 bg-[var(--color-base-alt)] rounded-full overflow-hidden min-w-[100px]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }}
        />
      </div>
      <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
        {formatCurrency(spent)} / {formatCurrency(budget)}
      </span>
      <span className={`text-xs font-medium w-12 text-right whitespace-nowrap ${status === "exceeded" ? "text-[var(--color-error)]" : status === "warning" ? "text-[var(--color-warning)]" : "text-[var(--text-tertiary)]"}`}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}

// ─── Budget Event Card ────────────────────────────────────────

function BudgetEventCard({
  event,
  onDelete,
}: {
  event: BudgetEvent;
  onDelete: (id: number) => void;
}) {
  const pct = event.total_amount > 0 ? (event.spent / event.total_amount) * 100 : 0;
  const daysLeft = Math.max(0, Math.ceil((new Date(event.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  return (
    <div className="card p-4 flex items-center gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-primary">{event.name}</h4>
          <span className="text-xs text-[var(--text-tertiary)]">
            {event.start_date} — {event.end_date}
          </span>
        </div>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          {formatCurrency(event.spent)} / {formatCurrency(event.total_amount)}
        </p>
        <div className="mt-2 h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden w-full max-w-[200px]">
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

// ─── Budget Suggestions Banner ────────────────────────────────

function BudgetSuggestionsBanner({ suggestions }: { suggestions: BudgetSuggestion[] }) {
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
        <span className="text-xs text-[var(--text-tertiary)]">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          {suggestions.slice(0, 5).map((s) => (
            <div key={s.category_id} className="flex items-center justify-between py-2 border-b border-[var(--border-color)] last:border-0">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.category_color }} />
                <span className="text-xs text-[var(--text-primary)]">{s.category_name}</span>
                <span className="text-xs text-[var(--text-tertiary)]">
                  Prom: {formatCurrency(s.avg_monthly)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {s.has_budget ? (
                  <span className="text-xs text-[var(--text-tertiary)]">
                    Actual: {formatCurrency(s.current_budget || 0)}
                  </span>
                ) : (
                  <>
                    <span className="text-xs text-[var(--color-primary)] font-medium">
                      Sugerido: {formatCurrency(s.suggested)}
                    </span>
                    <button
                      onClick={() => applyMutation.mutate(s)}
                      disabled={applyMutation.isPending}
                      className="text-xs px-2 py-1 rounded bg-[var(--color-primary)] text-white hover:opacity-90"
                    >
                      Aplicar
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── New Event Modal ──────────────────────────────────────────

function NewEventModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [amount, setAmount] = useState(0);

  const createMutation = useMutation({
    mutationFn: createBudgetEvent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget-events"] });
      onClose();
    },
  });

  const handleSubmit = () => {
    if (!name || !startDate || !endDate || amount <= 0) return;
    createMutation.mutate({
      name,
      start_date: startDate,
      end_date: endDate,
      total_amount: amount,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <h3 className="text-base font-semibold text-primary mb-4">Nuevo Evento Temporal</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Nombre</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Vacaciones Europa"
              className="input"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Inicio</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Fin</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Monto total</label>
            <input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
              placeholder="0"
              className="input"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name || !startDate || !endDate || amount <= 0 || createMutation.isPending}
            className="px-4 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {createMutation.isPending ? "Creando..." : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Quick Budget Config Modal ────────────────────────────────

function QuickConfigModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => import("../api/client").then((m) => m.getCategories()),
  });

  const { data: budgets = [] } = useQuery({
    queryKey: ["budgets"],
    queryFn: () => import("../api/client").then((m) => m.getBudgets()),
  });

  const [amounts, setAmounts] = useState<Record<number, number>>({});

  // Initialize amounts from existing budgets
  useState(() => {
    const initial: Record<number, number> = {};
    for (const b of budgets) {
      initial[b.category_id] = b.amount;
    }
    setAmounts(initial);
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { createBudget } = await import("../api/client");
      const promises = [];
      for (const [catId, amount] of Object.entries(amounts)) {
        if (amount > 0) {
          promises.push(createBudget({ category_id: parseInt(catId), amount }));
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

  // Filter to show only subcategories (leaves)
  const subcategories = categories.filter(
    (c) => !categories.some((p) => p.id === c.parent_id),
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-primary mb-4">Configurar Presupuestos</h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          Definí el límite mensual para cada categoría
        </p>

        <div className="space-y-3">
          {subcategories.map((cat) => (
            <div key={cat.id} className="flex items-center gap-3 py-2 border-b border-[var(--border-color)] last:border-0">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
              <span className="text-sm text-[var(--text-primary)] flex-1">{cat.name}</span>
              <div className="relative w-32">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] text-sm">$</span>
                <input
                  type="number"
                  value={amounts[cat.id] || ""}
                  onChange={(e) =>
                    setAmounts((prev) => ({
                      ...prev,
                      [cat.id]: parseFloat(e.target.value) || 0,
                    }))
                  }
                  placeholder="0"
                  className="input pl-6 text-sm py-1.5"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            Cancelar
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-4 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {saveMutation.isPending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Group Modal ─────────────────────────────────────────

function EditGroupModal({
  group,
  onClose,
}: {
  group: BudgetGroup;
  onClose: () => void;
}) {
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
        <h3 className="text-base font-semibold text-primary mb-4">
          Editar — {group.display_name}
        </h3>

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
                  // Recalculate amount based on total budget
                  const total = amount / (group.percentage / 100);
                  setAmount(Math.round(total * p / 100));
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
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-secondary)]">$</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                className="input flex-1"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Cancelar
          </button>
          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="px-4 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {updateMutation.isPending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Budget Page ─────────────────────────────────────────

export default function BudgetPage() {
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [showQuickConfig, setShowQuickConfig] = useState(false);
  const [editingGroup, setEditingGroup] = useState<BudgetGroup | null>(null);
  const qc = useQueryClient();

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ["budget-summary"],
    queryFn: () => getBudgetSummary(),
  });

  const { data: groups = [], isLoading: loadingGroups } = useQuery({
    queryKey: ["budget-groups"],
    queryFn: getBudgetGroups,
  });

  const { data: budgets = [], isLoading: loadingBudgets } = useQuery({
    queryKey: ["budgets"],
    queryFn: getBudgets,
  });

  const { data: events = [], isLoading: loadingEvents } = useQuery({
    queryKey: ["budget-events"],
    queryFn: getBudgetEvents,
  });

  const { data: suggestionsData } = useQuery({
    queryKey: ["budget-suggestions"],
    queryFn: getBudgetSuggestions,
  });

  const initGroupsMutation = useMutation({
    mutationFn: (income: number) => initBudgetGroups(income),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget-groups"] });
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: deleteBudgetEvent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget-events"] });
    },
  });

  const [incomeInput, setIncomeInput] = useState("");

  const handleInitGroups = () => {
    const income = parseFloat(incomeInput);
    if (income > 0) {
      initGroupsMutation.mutate(income);
    }
  };

  const isLoading = loadingSummary || loadingGroups || loadingBudgets || loadingEvents;

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-[var(--color-base-alt)] rounded w-48" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 bg-[var(--color-base-alt)] rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">Presupuesto</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Gestioná tus límites de gasto por categoría
          </p>
        </div>
        <button
          onClick={() => setShowNewEvent(true)}
          className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90"
        >
          + Nuevo Evento
        </button>
      </div>

      {/* 50/30/20 Groups or Init */}
      {groups.length > 0 ? (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
            Macro Grupos (50/30/20)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {groups.map((g) => (
              <BudgetGroupCard key={g.id} group={g} onEdit={setEditingGroup} />
            ))}
          </div>
        </div>
      ) : (
        <div className="card p-6 mb-6 text-center">
          <h3 className="text-base font-semibold text-primary mb-2">
            Inicializá tu presupuesto 50/30/20
          </h3>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Distribuí tu ingreso mensual en 3 macro grupos
          </p>
          <div className="flex items-center justify-center gap-2 max-w-xs mx-auto">
            <span className="text-sm text-[var(--text-secondary)]">$</span>
            <input
              type="number"
              value={incomeInput}
              onChange={(e) => setIncomeInput(e.target.value)}
              placeholder="Ingreso mensual"
              className="input flex-1"
            />
            <button
              onClick={handleInitGroups}
              disabled={!incomeInput || initGroupsMutation.isPending}
              className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {initGroupsMutation.isPending ? "..." : "Crear"}
            </button>
          </div>
        </div>
      )}

      {/* Overall Budget Summary - from groups */}
      {groups.length > 0 && (() => {
        const groupTotalBudget = groups.reduce((sum, g) => sum + g.amount, 0);
        const groupTotalSpent = groups.reduce((sum, g) => sum + g.spent, 0);
        const groupTotalPct = groupTotalBudget > 0 ? groupTotalSpent / groupTotalBudget : 0;
        const summaryStatus = groupTotalPct >= 1 ? "error" : groupTotalPct >= 0.8 ? "warning" : "success";

        return (
          <div className="card p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
                Resumen General
              </h2>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-primary">
                    {formatCurrency(groupTotalSpent)}
                  </span>
                  <span className="text-sm text-[var(--text-secondary)]">
                    / {formatCurrency(groupTotalBudget)}
                  </span>
                </div>
                <div className="mt-3 h-4 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(groupTotalPct * 100, 100)}%`,
                      backgroundColor: `var(--color-${summaryStatus})`,
                    }}
                  />
                </div>
                <p className="text-xs text-[var(--text-tertiary)] mt-2">
                  {Math.round(groupTotalPct * 100)}% del presupuesto utilizado
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Quick Budget Configuration */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
            Configuración Rápida
          </h2>
          <button
            onClick={() => setShowQuickConfig(true)}
            className="text-xs px-3 py-1.5 bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90"
          >
            + Agregar/Editar Presupuesto
          </button>
        </div>
        <p className="text-xs text-[var(--text-tertiary)]">
          Definí límites mensuales para cada categoría
        </p>
      </div>

      {/* Category Budgets by Group */}
      {summary && summary.categories.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
            Presupuestos por Categoría
          </h2>
          <div className="card p-5">
            {summary.categories.map((cat) => (
              <div key={cat.category_id}>
                <BudgetCategoryBar
                  name={cat.category_name}
                  color={cat.category_color}
                  spent={cat.spent_amount}
                  budget={cat.budget_amount}
                  threshold={0.8}
                />
                {cat.children.map((child) => (
                  <div key={child.category_id} className="pl-6">
                    <BudgetCategoryBar
                      name={child.category_name}
                      color={child.category_color}
                      spent={child.spent_amount}
                      budget={child.budget_amount}
                      threshold={0.8}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Budget Events */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
          Eventos Temporales
        </h2>
        {events.length > 0 ? (
          <div className="space-y-3">
            {events.map((event) => (
              <BudgetEventCard
                key={event.id}
                event={event}
                onDelete={(id) => deleteEventMutation.mutate(id)}
              />
            ))}
          </div>
        ) : (
          <div className="card p-6 text-center">
            <p className="text-sm text-[var(--text-tertiary)]">
              No hay eventos temporales creados
            </p>
            <button
              onClick={() => setShowNewEvent(true)}
              className="mt-2 text-sm text-[var(--color-primary)] hover:underline"
            >
              + Crear primer evento
            </button>
          </div>
        )}
      </div>

      {/* Suggestions */}
      {suggestionsData && suggestionsData.suggestions.length > 0 && (
        <BudgetSuggestionsBanner suggestions={suggestionsData.suggestions} />
      )}

      {/* New Event Modal */}
      {showNewEvent && <NewEventModal onClose={() => setShowNewEvent(false)} />}

      {/* Quick Config Modal */}
      {showQuickConfig && <QuickConfigModal onClose={() => setShowQuickConfig(false)} />}

      {/* Edit Group Modal */}
      {editingGroup && <EditGroupModal group={editingGroup} onClose={() => setEditingGroup(null)} />}
    </div>
  );
}
