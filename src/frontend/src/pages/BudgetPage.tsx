import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getBudgetSummary,
  getBudgetGroups,
  getBudgetEvents,
  getBudgetSuggestions,
  getBudgetConfig,
  createBudgetEvent,
  deleteBudgetEvent,
  initBudgetGroups,
} from "../api/client";
import { Select } from "../components/ui/Select";
import EmptyState from "../components/ui/EmptyState";
import SymbolicIcon from "../components/SymbolicIcon";
import { getCategoryIcon } from "../utils/categoryIcon";
import type { BudgetGroup, BudgetEvent, BudgetSuggestion, BudgetSummaryItem } from "../types";
import { formatCurrency } from "../utils/format";

// ─── Trend Spark (6-month spending bars, mock parity, no chart lib) ──

function TrendSpark({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-[3px] h-7 mt-2" aria-hidden="true">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${Math.max(8, (v / max) * 100)}%`,
            backgroundColor:
              i === values.length - 1
                ? "var(--color-warning)"
                : "color-mix(in srgb, var(--color-primary) 35%, transparent)",
          }}
        />
      ))}
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
  monthsWithData = 3,
  onClick,
}: {
  name: string;
  color: string;
  spent: number;
  budget: number;
  avgMonthly?: number;
  monthsWithData?: number;
  onClick?: () => void;
}) {
  const limitedEvidence = monthsWithData < 3;
  // Only hide if no budget AND no spending at all
  if (budget === 0 && spent === 0) return null;

  // Calculate remaining and percentage
  const remaining = budget > 0 ? budget - spent : 0;
  const pct = budget > 0 ? (spent / budget) * 100 : 0;

  // Status: dot + label (Adwaita tokens, no hardcoded hex, no emojis)
  let status: { label: string; color: string } | null = null;
  if (budget > 0) {
    if (pct >= 100) {
      status = { label: "Excedido", color: "var(--color-danger)" };
    } else if (pct >= 90) {
      status = { label: "Alerta", color: "var(--color-warning)" };
    } else if (pct >= 80) {
      status = { label: "Cuidado", color: "var(--color-warning)" };
    } else if (pct >= 60) {
      status = { label: "Normal", color: "var(--color-warning)" };
    } else {
      status = { label: "Bien", color: "var(--color-success)" };
    }
  }

  const overAvg = budget === 0 && avgMonthly > 0 && spent / avgMonthly >= 1;
  const nearAvg = budget === 0 && avgMonthly > 0 && spent / avgMonthly >= 0.8;
  const barColor =
    pct >= 100 || overAvg
      ? "var(--color-danger)"
      : pct >= 80 || nearAvg
        ? "var(--color-warning)"
        : "var(--color-success)";

  const icon = getCategoryIcon(name);
  const barPct =
    budget > 0
      ? Math.min(pct, 100)
      : avgMonthly > 0
        ? Math.min((spent / avgMonthly) * 100, 100)
        : 0;

  return (
    <div
      className="py-3 px-4 rounded-lg hover:bg-[var(--color-base-alt)] transition-colors cursor-pointer overflow-hidden"
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
            style={{ backgroundColor: `${color}20` }}
          >
            {icon ? (
              <SymbolicIcon name={icon} size={14} />
            ) : (
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            )}
          </span>
          <span className="text-sm font-medium text-[var(--text-primary)] truncate">{name}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {limitedEvidence && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full text-[var(--text-tertiary)] bg-[var(--color-base-alt)]">
              evidencia limitada
            </span>
          )}
          {status ? (
            <span
              className="text-xs font-semibold inline-flex items-center gap-1.5"
              style={{ color: status.color }}
            >
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ backgroundColor: status.color }}
              />
              {status.label}
            </span>
          ) : (
            <span className="text-xs text-[var(--text-tertiary)] italic">Sin presupuesto</span>
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--text-secondary)] mb-2 ml-9">
        {budget > 0 ? (
          <>
            {remaining >= 0 ? (
              <>
                {formatCurrency(remaining)} restantes de {formatCurrency(budget)}
              </>
            ) : (
              <span className="text-[var(--color-danger)]">
                {formatCurrency(Math.abs(remaining))} sobre {formatCurrency(budget)}
              </span>
            )}
          </>
        ) : (
          <>
            {formatCurrency(spent)} gastados
            {limitedEvidence && " · poco historial, punto de partida"}
          </>
        )}
      </p>
      <div className="flex items-center gap-3 ml-9">
        <div className="flex-1 h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${barPct}%`, backgroundColor: barColor }}
          />
        </div>
        <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
          <b className="text-[var(--text-primary)] font-semibold">
            {budget > 0 ? `${Math.round(pct)}%` : formatCurrency(spent)}
          </b>
          {avgMonthly > 0 && (
            <span className="text-[var(--text-tertiary)]">
              {" "}
              · prom {formatCurrency(avgMonthly)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

// ─── Category Group Section ────────────────────────────────────

function CategoryGroupSection({
  displayName,
  color,
  groupName,
  allCategories,
  onAddBudget,
  onCategoryClick,
}: {
  name: string;
  displayName: string;
  color: string;
  groupName: string;
  allCategories: BudgetSummaryItem[];
  onAddBudget: () => void;
  onCategoryClick: (cat: BudgetSummaryItem) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  // Collect ALL subcategories from ALL parent categories, then filter by this group's budget_group
  const allSubcategories = allCategories.flatMap((cat) => cat.children);
  const groupSubcategories = allSubcategories.filter((c) => c.budget_group === groupName);
  // Show all subcategories that have a budget OR have ever had expenses
  const visibleSubcategories = groupSubcategories.filter((c) => c.has_budget || c.spent_amount > 0);

  // Calculate totals from subcategories in this group
  const totalBudget = groupSubcategories.reduce((s, c) => s + c.budget_amount, 0);
  const totalSpent = groupSubcategories.reduce((s, c) => s + c.spent_amount, 0);
  const totalRemaining = totalBudget - totalSpent;

  if (visibleSubcategories.length === 0) return null;

  return (
    <>
      <p className="adw-caption-heading adw-dim-label px-1 mb-1.5">
        {displayName.toUpperCase()} · {visibleSubcategories.length}{" "}
        {visibleSubcategories.length === 1 ? "SUBCATEGORÍA" : "SUBCATEGORÍAS"}
        {totalBudget > 0 && <> · {formatCurrency(totalRemaining)} REST.</>}
      </p>
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
                className={`text-xs font-semibold ${
                  totalRemaining < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"
                }`}
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
              className={`text-[var(--text-tertiary)] transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
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
                monthsWithData={cat.months_with_data}
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
    </>
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
  const remaining = event.total_amount - event.spent;

  const barColor =
    pct >= 100
      ? "var(--color-danger)"
      : pct >= 80
        ? "var(--color-warning)"
        : pct >= 60
          ? "var(--gnome-yellow-4)"
          : "var(--color-success)";

  return (
    <div
      className="card p-4 cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => onClick(event)}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
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
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="text-center">
          <p className="adw-caption adw-dim-label">PRESUPUESTO</p>
          <p className="text-sm font-bold text-primary">{formatCurrency(event.total_amount)}</p>
        </div>
        <div className="text-center">
          <p className="adw-caption adw-dim-label">GASTADO</p>
          <p className="text-sm font-bold text-primary">{formatCurrency(event.spent)}</p>
        </div>
        <div className="text-center">
          <p className="adw-caption adw-dim-label">RESTANTE</p>
          <p
            className={`text-sm font-bold ${
              remaining < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"
            }`}
          >
            {formatCurrency(remaining)}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden mb-2">
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

// ─── Unassigned Section (inline suggestions, replaces banner) ─────

function UnbudgetedSection() {
  const qc = useQueryClient();

  const { data: suggestionsData } = useQuery({
    queryKey: ["budget-suggestions"],
    queryFn: getBudgetSuggestions,
  });

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

  const items = (suggestionsData?.suggestions ?? []).filter((s) => !s.has_budget);
  if (items.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="adw-caption-heading adw-dim-label px-1 mb-1.5">
        SIN ASIGNAR · {items.length} {items.length === 1 ? "CATEGORÍA" : "CATEGORÍAS"}
      </p>
      <div className="rounded-xl border border-[var(--border-color)] overflow-hidden bg-[var(--color-surface)]">
        {items.map((s) => {
          const icon = getCategoryIcon(s.category_name);
          return (
            <div
              key={s.category_id}
              className="py-3 px-4 border-b border-[var(--border-color)] last:border-b-0"
            >
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
                    style={{ backgroundColor: `${s.category_color}20` }}
                  >
                    {icon ? (
                      <SymbolicIcon name={icon} size={14} />
                    ) : (
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: s.category_color }}
                      />
                    )}
                  </span>
                  <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {s.category_name}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {s.months_with_data < 3 && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full text-[var(--text-tertiary)] bg-[var(--color-base-alt)]">
                      evidencia limitada
                    </span>
                  )}
                  <span className="text-xs text-[var(--text-tertiary)] italic">
                    sin presupuesto
                  </span>
                </div>
              </div>
              <p className="text-xs text-[var(--text-secondary)] mb-2 ml-9">
                prom {formatCurrency(s.avg_monthly)}/mes
                {s.months_with_data < 3 && " · poco historial"}
              </p>
              <div
                className="flex items-center justify-between gap-2 ml-9 rounded-lg px-3 py-2"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--color-primary) 6%, transparent)",
                  border: "1px dashed color-mix(in srgb, var(--color-primary) 40%, transparent)",
                }}
              >
                <span className="text-xs text-[var(--text-secondary)]">
                  Sugerido <strong>{formatCurrency(s.suggested)}</strong>
                </span>
                <button
                  onClick={() => applyMutation.mutate(s)}
                  disabled={applyMutation.isPending}
                  className="text-xs text-[var(--color-primary)] hover:underline font-medium disabled:opacity-50"
                >
                  Asignar
                </button>
              </div>
            </div>
          );
        })}
      </div>
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
    {
      parent: (typeof allCategories)[0] | null;
      children: typeof leafCategories;
    }
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
    {
      parent: (typeof allCategories)[0] | null;
      children: typeof leafCategories;
    }
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
          <EmptyState
            icon="cash"
            title="Sin gastos este mes"
            description="Todavía no hay categorías con gastos. Registrá un gasto para empezar a presupuestar."
            action={{ label: "Cerrar", onClick: onClose }}
          />
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
                      onChange={(v) =>
                        setGroupAssignments({
                          ...groupAssignments,
                          [cat.id]: v,
                        })
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
                      value={amounts[cat.id] || budgetAmounts.get(cat.id) || ""}
                      onChange={(e) =>
                        setAmounts({
                          ...amounts,
                          [cat.id]: parseFloat(e.target.value) || 0,
                        })
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
            updateBudgetGroup(grp.id, {
              percentage: data.percentage,
              amount: data.amount,
            }),
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
                        [g.name]: {
                          percentage: p,
                          amount: Math.round((total * p) / 100),
                        },
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
                        [g.name]: {
                          ...groupData[g.name],
                          amount: parseFloat(e.target.value) || 0,
                        },
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
                className={`text-sm font-bold ${
                  event.total_amount - event.spent < 0
                    ? "text-[var(--color-danger)]"
                    : "text-[var(--color-success)]"
                }`}
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

  // Daily pace vs budget pace (current month)
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dailyAvg = dayOfMonth > 0 ? totalSpent / dayOfMonth : 0;
  const budgetPace = daysInMonth > 0 ? totalBudget / daysInMonth : 0;
  const paceOk = budgetPace <= 0 || dailyAvg <= budgetPace * 1.1;
  const spentPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const monthLabelRaw = now.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const monthLabel = monthLabelRaw.charAt(0).toUpperCase() + monthLabelRaw.slice(1);
  const trendValues = (summary?.trend_6m ?? []).map((t) => t.total);

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
          <h1 className="adw-title-2 text-primary">Presupuesto</h1>
          <p className="adw-caption adw-dim-label">{monthLabel} · montos en ARS</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowQuickConfig(true)} className="gnome-btn-secondary">
            Configurar
          </button>
          <button onClick={() => setShowNewEvent(true)} className="gnome-btn-primary">
            + Nuevo evento
          </button>
        </div>
      </div>

      {/* 50/30/20 Groups or Init */}
      {groups.length > 0 ? (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="card p-4">
              <p className="adw-caption adw-dim-label mb-1">DISPONIBLE</p>
              <p
                className={`text-lg font-bold ${
                  totalAvailable < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"
                }`}
              >
                {formatCurrency(totalAvailable)}
              </p>
              <p className="adw-caption adw-dim-label mt-1">
                de {formatCurrency(totalBudget)} presupuestados
              </p>
              <TrendSpark values={trendValues} />
            </div>
            <div className="card p-4">
              <p className="adw-caption adw-dim-label mb-1">GASTADO VS PRESUPUESTO</p>
              <p className="text-lg font-bold text-primary">{formatCurrency(totalSpent)}</p>
              <p className="adw-caption adw-dim-label mt-1">{spentPct}% del presupuesto</p>
              <TrendSpark values={trendValues} />
            </div>
            <div className="card p-4">
              <p className="adw-caption adw-dim-label mb-1">RITMO DIARIO</p>
              <p className="text-lg font-bold text-primary">
                {formatCurrency(dailyAvg)}
                <span className="adw-caption adw-dim-label font-normal">/día</span>
              </p>
              <p className={`adw-caption mt-1 ${paceOk ? "text-success" : "text-warning"}`}>
                {paceOk ? "dentro de banda" : "por encima del ritmo"}
              </p>
            </div>
          </div>

          {/* Category Groups */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="adw-caption-heading text-[var(--text-secondary)]">POR GRUPO</h2>
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
            {summary && summary.categories.length > 0 ? (
              <>
                {groups.map((g) => (
                  <CategoryGroupSection
                    key={g.name}
                    name={g.name}
                    displayName={g.display_name}
                    color={groupColors[g.name] || "var(--color-primary)"}
                    groupName={g.name}
                    allCategories={summary.categories}
                    onAddBudget={() => setShowQuickConfig(true)}
                    onCategoryClick={setSelectedCategory}
                  />
                ))}
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

          <UnbudgetedSection />

          {/* Events */}
          {events.length > 0 && (
            <div className="mb-6">
              <h2 className="adw-caption-heading text-[var(--text-secondary)] mb-2">
                EVENTOS TEMPORALES
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
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
            className={`grid grid-cols-1 sm:grid-cols-${
              budgetConfig?.ahorro_enabled ? 3 : 2
            } gap-4 mb-6`}
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
