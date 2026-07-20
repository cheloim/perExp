import { useState, useEffect, useMemo, memo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getBudgetSummary,
  getBudgetGroups,
  getBudgets,
  getBudgetEvents,
  getBudgetSuggestions,
  getBudgetConfig,
  createBudgetEvent,
  deleteBudgetEvent,
  initBudgetGroups,
} from "../api/client";
import { Select } from "../components/ui/Select";
import type { BudgetGroup, BudgetEvent, BudgetSuggestion, BudgetSummaryItem } from "../types";
import { formatCurrency } from "../utils/format";

// ─── Donut Circle (50/30/20) ───────────────────────────────────

const DonutCircle = memo(function DonutCircle({
  group,
  color,
  selected,
  onSelect,
}: {
  group: BudgetGroup;
  color: string;
  selected: boolean;
  onSelect: () => void;
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
        <span>Asignado: {formatCurrency(group.amount)}</span>
        <span>Gastado: {formatCurrency(group.spent)}</span>
      </div>
    </div>
  );
});

// ─── Category Bar with Gradient ────────────────────────────────

function CategoryBar({
  name,
  color,
  spent,
  budget,
  avgMonthly = 0,
  onClick,
}: {
  name: string;
  color: string;
  spent: number;
  budget: number;
  avgMonthly?: number;
  onClick?: () => void;
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
      <div
        className="py-3 px-4 rounded-lg hover:bg-[var(--color-base-alt)] transition-colors cursor-pointer"
        onClick={onClick}
      >
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
      </div>
    );
  }

  // With budget — show remaining prominently
  return (
    <div
      className="py-3 px-4 rounded-lg hover:bg-[var(--color-base-alt)] transition-colors cursor-pointer"
      onClick={onClick}
    >
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
  onCategoryClick,
}: {
  name: string;
  displayName: string;
  color: string;
  categories: BudgetSummaryItem[];
  onAddBudget: () => void;
  onCategoryClick: (cat: BudgetSummaryItem) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const totalBudget = categories.reduce((s, c) => s + c.budget_amount, 0);
  const totalSpent = categories.reduce((s, c) => s + c.spent_amount, 0);
  const totalRemaining = totalBudget - totalSpent;

  // Collect all subcategories (children) from all parent categories
  const subcategories = categories.flatMap((cat) => cat.children);
  const visibleSubcategories = subcategories.filter((c) => c.spent_amount > 0);
  if (visibleSubcategories.length === 0) return null;

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
            {visibleSubcategories.length}{" "}
            {visibleSubcategories.length === 1 ? "subcategoría" : "subcategorías"}
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

      {/* Subcategories List */}
      {expanded && (
        <div className="border-t border-[var(--border-color)] bg-[var(--color-base)]/50">
          {visibleSubcategories.map((cat) => (
            <CategoryBar
              key={cat.category_id}
              name={cat.category_name}
              color={cat.category_color}
              spent={cat.spent_amount}
              budget={cat.budget_amount}
              avgMonthly={cat.avg_monthly}
              onClick={() => onCategoryClick(cat)}
            />
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

function EventCard({
  event,
  onDelete,
  onLinkExpenses,
  onClick,
}: {
  event: BudgetEvent;
  onDelete: (id: number) => void;
  onLinkExpenses: (event: BudgetEvent) => void;
  onClick: (event: BudgetEvent) => void;
}) {
  const pct = event.total_amount > 0 ? (event.spent / event.total_amount) * 100 : 0;
  const startDate = new Date(event.start_date);
  const endDate = new Date(event.end_date);
  const totalDays =
    Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  const remaining = event.total_amount - event.spent;

  const barColor =
    pct >= 100
      ? "var(--color-danger)"
      : pct >= 80
        ? "#e8a100"
        : pct >= 60
          ? "var(--gnome-yellow-4)"
          : "var(--color-success)";

  return (
    <div
      className="card p-5 cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => onClick(event)}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-base font-semibold text-primary">{event.name}</h4>
          <p className="text-xs text-[var(--text-tertiary)]">
            {event.start_date} — {event.end_date}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(event.id);
          }}
          className="text-[var(--text-tertiary)] hover:text-[var(--color-error)] text-lg p-1"
        >
          ×
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <div className="text-center">
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Días total</p>
          <p className="text-sm font-bold text-primary">{totalDays}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Restantes</p>
          <p
            className={`text-sm font-bold ${daysLeft === 0 ? "text-[var(--text-tertiary)]" : "text-[var(--color-primary)]"}`}
          >
            {daysLeft}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Usado</p>
          <p
            className={`text-sm font-bold ${pct >= 100 ? "text-[var(--color-danger)]" : pct >= 80 ? "text-[#e8a100]" : "text-[var(--color-success)]"}`}
          >
            {Math.round(pct)}%
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Quedan</p>
          <p
            className={`text-sm font-bold ${remaining < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}
          >
            {formatCurrency(remaining)}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-3 bg-[var(--color-base-alt)] rounded-full overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }}
        />
      </div>
      <p className="text-xs text-[var(--text-secondary)]">
        {formatCurrency(event.spent)} / {formatCurrency(event.total_amount)}
      </p>

      {/* Actions */}
      <div className="flex gap-2 mt-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLinkExpenses(event);
          }}
          className="flex-1 px-3 py-2 text-xs font-medium text-[var(--color-primary)] border border-[var(--color-primary)]/30 rounded-lg hover:bg-[var(--color-primary)]/10 transition-colors"
        >
          Vincular gastos
        </button>
      </div>
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
  const { data: allCategories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => import("../api/client").then((m) => m.getCategories()),
  });
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
  const budgetAmounts = new Map(budgets.map((b) => [b.category_id, b.amount]));

  // Get category IDs that have spending (from summary, including children)
  const spentCatIds = new Set(
    summary?.categories
      .flatMap((c) => [c.category_id, ...c.children.map((ch) => ch.category_id)])
      .filter((id): id is number => id !== null) ?? [],
  );

  // Get ALL leaf categories (no children in the full list)
  const leafCategories = allCategories.filter(
    (c) => !allCategories.some((p) => p.id === c.parent_id),
  );

  // Filter to leaves that have spending
  const categoriesWithSpending = leafCategories.filter((c) => spentCatIds.has(c.id));

  // Group by parent for display
  const groupedByParent = new Map<
    string,
    { parent: (typeof allCategories)[0] | null; children: typeof leafCategories }
  >();
  for (const cat of categoriesWithSpending) {
    const parentId = String(cat.parent_id ?? "root");
    if (!groupedByParent.has(parentId)) {
      const parent = cat.parent_id
        ? (allCategories.find((c) => c.id === cat.parent_id) ?? null)
        : null;
      groupedByParent.set(parentId, { parent, children: [] });
    }
    groupedByParent.get(parentId)!.children.push(cat);
  }

  const [amounts, setAmounts] = useState<Record<number, number>>(() => {
    const initial: Record<number, number> = {};
    for (const b of budgets) initial[b.category_id] = b.amount;
    return initial;
  });
  const [groupAssignments, setGroupAssignments] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    for (const c of categoriesWithSpending) {
      initial[c.id] = c.budget_group || "";
    }
    return initial;
  });
  const [searchQuery, setSearchQuery] = useState("");

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
      qc.invalidateQueries({ queryKey: ["budget-groups"] });
      onClose();
    },
  });

  // Filter by search
  const filteredCategories = searchQuery
    ? categoriesWithSpending.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : categoriesWithSpending;

  // Group filtered categories by parent for display
  const filteredGrouped = new Map<
    string,
    { parent: (typeof allCategories)[0] | null; children: typeof leafCategories }
  >();
  for (const cat of filteredCategories) {
    const parentId = String(cat.parent_id ?? "root");
    if (!filteredGrouped.has(parentId)) {
      const parent = cat.parent_id
        ? (allCategories.find((c) => c.id === cat.parent_id) ?? null)
        : null;
      filteredGrouped.set(parentId, { parent, children: [] });
    }
    filteredGrouped.get(parentId)!.children.push(cat);
  }

  const totalCategories = filteredCategories.length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-primary mb-2">
          Configurar presupuestos por categoría
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          Definí el límite mensual y el grupo para cada categoría con gastos
        </p>
        <div className="mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar categoría..."
            className="input w-full text-sm"
          />
        </div>
        {totalCategories === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-[var(--text-secondary)]">
              No hay categorías con gastos este mes
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(filteredGrouped.entries()).map(([parentId, group]) => (
              <div key={parentId ?? "root"}>
                {/* Parent header */}
                {group.parent && (
                  <h4 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wide mb-2">
                    {group.parent.name}
                  </h4>
                )}
                {/* Children rows */}
                {group.children.map((cat) => (
                  <div
                    key={cat.id}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-[var(--color-base-alt)] transition-colors"
                  >
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="text-sm font-medium text-primary min-w-[120px] truncate">
                      {cat.name}
                    </span>
                    <Select
                      value={groupAssignments[cat.id] || ""}
                      onChange={(v) => setGroupAssignments({ ...groupAssignments, [cat.id]: v })}
                      options={[
                        { value: "", label: "Sin grupo" },
                        { value: "necesidades", label: "Necesidades" },
                        { value: "gustos", label: "Gustos" },
                        { value: "ahorro", label: "Ahorro" },
                      ]}
                    />
                    <input
                      type="number"
                      value={amounts[cat.id] || budgetAmounts.get(cat.id) || ""}
                      onChange={(e) =>
                        setAmounts({ ...amounts, [cat.id]: parseFloat(e.target.value) || 0 })
                      }
                      placeholder={
                        budgetAmounts.has(cat.id) ? formatCurrency(budgetAmounts.get(cat.id)!) : "0"
                      }
                      className="input flex-1 !py-1.5"
                    />
                    {budgetedCatIds.has(cat.id) && (
                      <span className="text-[10px] text-[var(--color-success)] flex-shrink-0">
                        ✓
                      </span>
                    )}
                  </div>
                ))}
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
            disabled={saveMutation.isPending}
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

function EditGroupModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: allGroups = [] } = useQuery({
    queryKey: ["budget-groups"],
    queryFn: getBudgetGroups,
  });

  const [groupData, setGroupData] = useState<
    Record<string, { percentage: number; amount: number }>
  >(() => {
    const initial: Record<string, { percentage: number; amount: number }> = {};
    for (const g of allGroups) {
      initial[g.name] = { percentage: g.percentage, amount: g.amount };
    }
    return initial;
  });

  const totalPercentage = Object.values(groupData).reduce((s, g) => s + g.percentage, 0);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { updateBudgetGroup } = await import("../api/client");
      const promises = [];
      for (const [name, data] of Object.entries(groupData)) {
        const grp = allGroups.find((g) => g.name === name);
        if (grp) {
          promises.push(
            updateBudgetGroup(grp.id, { percentage: data.percentage, amount: data.amount }),
          );
        }
      }
      return Promise.all(promises);
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
        <h3 className="text-base font-semibold text-primary mb-4">Editar grupos</h3>
        <div className="space-y-4">
          {allGroups.map((g) => (
            <div key={g.name} className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-medium text-primary mb-2">{g.display_name}</p>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] text-[var(--text-secondary)] mb-1">
                    % Ingreso
                  </label>
                  <input
                    type="number"
                    value={groupData[g.name]?.percentage || 0}
                    onChange={(e) => {
                      const p = parseFloat(e.target.value) || 0;
                      const total =
                        (groupData[g.name]?.amount || 0) /
                        ((groupData[g.name]?.percentage || 1) / 100);
                      setGroupData({
                        ...groupData,
                        [g.name]: { percentage: p, amount: Math.round((total * p) / 100) },
                      });
                    }}
                    min="0"
                    max="100"
                    className="input w-full text-xs"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] text-[var(--text-secondary)] mb-1">
                    Monto
                  </label>
                  <input
                    type="number"
                    value={groupData[g.name]?.amount || 0}
                    onChange={(e) =>
                      setGroupData({
                        ...groupData,
                        [g.name]: { ...groupData[g.name], amount: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="input w-full text-xs"
                  />
                </div>
              </div>
            </div>
          ))}
          {totalPercentage !== 100 && (
            <p className="text-xs text-[var(--color-warning)]">
              Total: {totalPercentage}% (debería ser 100%)
            </p>
          )}
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
        <h3 className="text-base font-semibold text-primary mb-4">Nuevo evento temporal</h3>
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

// ─── Category Side Panel ──────────────────────────────────────

function CategorySidePanel({
  category,
  onClose,
}: {
  category: BudgetSummaryItem;
  onClose: () => void;
}) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Collect category IDs: the category itself + its children
  const categoryIds = [category.category_id, ...category.children.map((c) => c.category_id)].filter(
    (id): id is number => id !== null,
  );

  const [expenses, setExpenses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (categoryIds.length === 0) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    import("../api/client").then((m) =>
      m
        .getExpenses({
          category_ids: categoryIds.join(","),
          month: currentMonth,
        })
        .then((data) => {
          if (!cancelled) {
            setExpenses(data);
            setIsLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setExpenses([]);
            setIsLoading(false);
          }
        }),
    );

    return () => {
      cancelled = true;
    };
  }, [categoryIds.join(","), currentMonth]);

  // Close on Escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-[var(--color-surface)] border-l border-[var(--border-color)] shadow-xl overflow-y-auto animate-slide-in">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: category.category_color }}
              />
              <div>
                <h2 className="text-base font-semibold text-primary">{category.category_name}</h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  {formatCurrency(category.budget_amount - category.spent_amount)} restantes de{" "}
                  {formatCurrency(category.budget_amount)}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-[var(--color-base-alt)] flex items-center justify-center transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Expenses List */}
        <div className="px-5 py-4">
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-sm text-[var(--text-tertiary)]">Cargando gastos...</p>
            </div>
          ) : expenses.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-[var(--text-tertiary)]">
                No hay gastos en esta categoría este mes
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {expenses.map((expense: any) => (
                <div
                  key={expense.id}
                  className="flex items-center justify-between py-2 border-b border-[var(--border-color)]"
                >
                  <div>
                    <p className="text-sm text-[var(--text-primary)]">{expense.description}</p>
                    <p className="text-xs text-[var(--text-tertiary)]">{expense.date}</p>
                  </div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {formatCurrency(expense.amount)}
                  </p>
                </div>
              ))}
              <div className="flex justify-between pt-2 font-semibold">
                <span className="text-sm text-[var(--text-secondary)]">Total</span>
                <span className="text-sm text-primary">
                  {formatCurrency(expenses.reduce((s: number, e: any) => s + e.amount, 0))}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Event Side Panel ──────────────────────────────────────────

function EventSidePanel({ event, onClose }: { event: BudgetEvent; onClose: () => void }) {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    import("../api/client").then((m) =>
      m.getEventExpenses(event.id).then((data) => {
        if (!cancelled) {
          setExpenses(data);
          setIsLoading(false);
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [event.id]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const linkedExpenses = expenses.filter((e: any) => e.linked);
  const availableExpenses = expenses.filter((e: any) => !e.linked);
  const totalLinked = linkedExpenses.reduce((s: number, e: any) => s + e.amount, 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[var(--color-surface)] border-l border-[var(--border-color)] shadow-xl overflow-y-auto animate-slide-in">
        <div className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-primary">{event.name}</h2>
              <p className="text-xs text-[var(--text-secondary)]">
                {event.start_date} — {event.end_date}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-[var(--color-base-alt)] flex items-center justify-center"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Presupuesto</p>
              <p className="text-sm font-bold text-primary">{formatCurrency(event.total_amount)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Gastado</p>
              <p className="text-sm font-bold text-primary">{formatCurrency(event.spent)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Restante</p>
              <p
                className={`text-sm font-bold ${event.total_amount - event.spent < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}
              >
                {formatCurrency(event.total_amount - event.spent)}
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          {isLoading ? (
            <p className="text-sm text-[var(--text-tertiary)] text-center py-8">Cargando...</p>
          ) : (
            <>
              {linkedExpenses.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
                    Vinculados ({linkedExpenses.length})
                  </p>
                  {linkedExpenses.map((exp: any) => (
                    <div
                      key={exp.id}
                      className="flex items-center justify-between py-2 border-b border-[var(--border-color)]"
                    >
                      <div>
                        <p className="text-sm text-[var(--text-primary)]">{exp.description}</p>
                        <p className="text-xs text-[var(--text-tertiary)]">
                          {exp.date} · {exp.category_name || "Sin categoría"}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-primary">
                        {formatCurrency(exp.amount)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-2 font-semibold">
                    <span className="text-sm text-[var(--text-secondary)]">Total</span>
                    <span className="text-sm text-primary">{formatCurrency(totalLinked)}</span>
                  </div>
                </div>
              )}
              {availableExpenses.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
                    Disponibles ({availableExpenses.length})
                  </p>
                  {availableExpenses.map((exp: any) => (
                    <div
                      key={exp.id}
                      className="flex items-center justify-between py-2 border-b border-[var(--border-color)] opacity-60"
                    >
                      <div>
                        <p className="text-sm text-[var(--text-primary)]">{exp.description}</p>
                        <p className="text-xs text-[var(--text-tertiary)]">
                          {exp.date} · {exp.category_name || "Sin categoría"}
                        </p>
                      </div>
                      <span className="text-sm text-[var(--text-secondary)]">
                        {formatCurrency(exp.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {expenses.length === 0 && (
                <p className="text-sm text-[var(--text-tertiary)] text-center py-8">
                  No hay gastos en este período
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Link Expenses to Event Modal ──────────────────────────────

function LinkExpensesModal({ event, onClose }: { event: BudgetEvent; onClose: () => void }) {
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["event-expenses", event.id],
    queryFn: () => import("../api/client").then((m) => m.getEventExpenses(event.id)),
  });

  const linkMutation = useMutation({
    mutationFn: () =>
      import("../api/client").then((m) => m.linkExpensesToEvent(event.id, Array.from(selectedIds))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget-events"] });
      onClose();
    },
  });

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalSelected = expenses
    .filter((e: any) => selectedIds.has(e.id))
    .reduce((s: number, e: any) => s + e.amount, 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-primary mb-2">
          Vincular gastos — {event.name}
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          Seleccioná los gastos que pertenecen a este evento
        </p>

        {isLoading ? (
          <p className="text-sm text-[var(--text-tertiary)] text-center py-8">Cargando...</p>
        ) : expenses.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)] text-center py-8">
            No hay gastos en este período
          </p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {expenses.map((expense: any) => (
              <label
                key={expense.id}
                className="flex items-center gap-3 py-2 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--color-base-alt)] cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(expense.id)}
                  onChange={() => toggle(expense.id)}
                  className="w-4 h-4 rounded accent-[var(--color-primary)]"
                />
                <div className="flex-1">
                  <p className="text-xs font-medium text-primary">{expense.description}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">
                    {expense.date} · {expense.category_name || "Sin categoría"}
                  </p>
                </div>
                <span className="text-xs font-semibold text-primary">
                  {formatCurrency(expense.amount)}
                </span>
              </label>
            ))}
          </div>
        )}

        {selectedIds.size > 0 && (
          <p className="text-xs text-[var(--text-secondary)] mt-3 text-center">
            Seleccionados: {formatCurrency(totalSelected)}
          </p>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
          >
            Cancelar
          </button>
          <button
            onClick={() => linkMutation.mutate()}
            disabled={selectedIds.size === 0 || linkMutation.isPending}
            className="flex-1 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {linkMutation.isPending ? "Vinculando..." : `Vincular (${selectedIds.size})`}
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
  const [selectedCategory, setSelectedCategory] = useState<BudgetSummaryItem | null>(null);
  const [linkingEvent, setLinkingEvent] = useState<BudgetEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<BudgetEvent | null>(null);

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

  const { data: budgetConfig } = useQuery({
    queryKey: ["budget-config"],
    queryFn: getBudgetConfig,
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

  // Compute KPIs
  const totalBudget = useMemo(() => groups.reduce((s, g) => s + g.amount, 0), [groups]);
  const totalSpent = useMemo(() => groups.reduce((s, g) => s + g.spent, 0), [groups]);
  const totalAvailable = totalBudget - totalSpent;

  // Count categories with spending but no budget (using summary directly — it already includes all categories with spending)
  const unbudgetedCount = useMemo(() => {
    const budgetedCatIds = new Set(allBudgets.map((b) => b.category_id));
    return (
      summary?.categories.filter(
        (c) => c.category_id !== null && c.spent_amount > 0 && !budgetedCatIds.has(c.category_id),
      ).length ?? 0
    );
  }, [summary, allBudgets]);

  // Group categories by macro group
  const groupColors: Record<string, string> = {
    necesidades: "var(--color-primary)",
    gustos: "var(--color-warning)",
    ahorro: "var(--color-success)",
  };

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
            + Nuevo evento
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
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">
                Distribución del presupuesto
              </h2>
              {groups.length > 0 && (
                <button
                  onClick={() => setEditingGroup(groups[0])}
                  className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 rounded-lg px-3 py-1.5 transition-colors"
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
                  Editar grupos
                </button>
              )}
            </div>
            <div className={`grid grid-cols-1 sm:grid-cols-${groups.length} gap-4`}>
              {groups.map((g) => (
                <DonutCircle
                  key={g.id}
                  group={g}
                  color={groupColors[g.name] || "var(--color-primary)"}
                  selected={selectedGroup === g.name}
                  onSelect={() => setSelectedGroup(selectedGroup === g.name ? null : g.name)}
                />
              ))}
            </div>
          </div>

          {/* Suggestions */}
          {suggestionsData && suggestionsData.suggestions.length > 0 && (
            <SuggestionsBanner suggestions={suggestionsData.suggestions} />
          )}

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
                    onCategoryClick={setSelectedCategory}
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
                      onCategoryClick={setSelectedCategory}
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
              <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">
                Eventos temporales
              </h2>
              <div className="space-y-4">
                {events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onDelete={(id) => deleteEventMutation.mutate(id)}
                    onLinkExpenses={setLinkingEvent}
                    onClick={setSelectedEvent}
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
          <div
            className={`grid grid-cols-1 sm:grid-cols-${budgetConfig?.ahorro_enabled ? 3 : 2} gap-4 mb-6`}
          >
            <div className="p-4 rounded-xl border border-[var(--border-color)] text-center">
              <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center mx-auto mb-2">
                <span className="text-[var(--color-primary)] font-bold">
                  {budgetConfig?.ahorro_enabled ? "50%" : "60%"}
                </span>
              </div>
              <p className="text-sm font-semibold text-primary">Necesidades</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Alimentación, Transporte, Salud, Hogar
              </p>
            </div>
            <div className="p-4 rounded-xl border border-[var(--border-color)] text-center">
              <div className="w-10 h-10 rounded-full bg-[var(--color-warning)]/10 flex items-center justify-center mx-auto mb-2">
                <span className="text-[var(--color-warning)] font-bold">
                  {budgetConfig?.ahorro_enabled ? "30%" : "40%"}
                </span>
              </div>
              <p className="text-sm font-semibold text-primary">Gustos</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Entretenimiento, Salidas, Ropa
              </p>
            </div>
            {budgetConfig?.ahorro_enabled && (
              <div className="p-4 rounded-xl border border-[var(--border-color)] text-center">
                <div className="w-10 h-10 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center mx-auto mb-2">
                  <span className="text-[var(--color-success)] font-bold">20%</span>
                </div>
                <p className="text-sm font-semibold text-primary">Ahorro</p>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">Inversiones, Ahorro</p>
              </div>
            )}
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

      {/* Modals */}
      {showNewEvent && <NewEventModal onClose={() => setShowNewEvent(false)} />}
      {showQuickConfig && <QuickConfigModal onClose={() => setShowQuickConfig(false)} />}
      {editingGroup && <EditGroupModal onClose={() => setEditingGroup(null)} />}
      {selectedCategory && (
        <CategorySidePanel category={selectedCategory} onClose={() => setSelectedCategory(null)} />
      )}
      {linkingEvent && (
        <LinkExpensesModal event={linkingEvent} onClose={() => setLinkingEvent(null)} />
      )}
      {selectedEvent && (
        <EventSidePanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}
