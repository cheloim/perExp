import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
import { CurrencyInput } from "../components/ui/CurrencyInput";
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
  onEdit,
}: {
  name: string;
  color: string;
  spent: number;
  budget: number;
  avgMonthly?: number;
  monthsWithData?: number;
  onClick?: () => void;
  onEdit?: () => void;
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
      className="group py-3 px-4 rounded-lg hover:bg-[var(--color-base-alt)] transition-colors cursor-pointer overflow-hidden"
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
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              title="Editar presupuesto"
              aria-label={`Editar presupuesto de ${name}`}
              className="w-7 h-7 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition flex items-center justify-center"
            >
              <SymbolicIcon name="pencil" size={13} />
            </button>
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
  onCategoryEdit,
  onEditGroup,
}: {
  name: string;
  displayName: string;
  color: string;
  groupName: string;
  allCategories: BudgetSummaryItem[];
  onAddBudget: () => void;
  onCategoryClick: (cat: BudgetSummaryItem) => void;
  onCategoryEdit: (cat: BudgetSummaryItem) => void;
  onEditGroup: () => void;
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
          <span
            role="button"
            tabIndex={0}
            title={`Editar grupo ${displayName}`}
            aria-label={`Editar grupo ${displayName}`}
            onClick={(e) => {
              e.stopPropagation();
              onEditGroup();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onEditGroup();
              }
            }}
            className="w-7 h-7 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition flex items-center justify-center"
          >
            <SymbolicIcon name="pencil" size={13} />
          </span>
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
              onEdit={() => onCategoryEdit(cat)}
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

// ─── Edit Budget Modal (single category: create / update / delete) ─

function EditBudgetModal({
  category,
  onClose,
}: {
  category: BudgetSummaryItem;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: budgets = [] } = useQuery({
    queryKey: ["budgets"],
    queryFn: () => import("../api/client").then((m) => m.getBudgets()),
  });
  const existing = budgets.find((b) => b.category_id === category.category_id) ?? null;
  const fallback =
    existing?.amount ?? (category.avg_monthly > 0 ? Math.round(category.avg_monthly) : null);
  const [amount, setAmount] = useState<number | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = amount ?? fallback;
  const groupValue = group ?? category.budget_group ?? "necesidades";
  const icon = getCategoryIcon(category.category_name);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["budget-summary"] });
    qc.invalidateQueries({ queryKey: ["budget-suggestions"] });
    qc.invalidateQueries({ queryKey: ["budget-groups"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { createBudget, updateBudget, updateCategoryGroup } = await import("../api/client");
      if (!value || value <= 0) throw new Error("Ingresá un monto mayor a cero");
      if (group && group !== category.budget_group && category.category_id !== null) {
        await updateCategoryGroup(category.category_id, group);
      }
      if (existing) return updateBudget(existing.id, { amount: value });
      return createBudget({ category_id: category.category_id!, amount: value });
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { deleteBudget } = await import("../api/client");
      if (!existing) throw new Error("Sin presupuesto para eliminar");
      return deleteBudget(existing.id);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: () => setError("No se pudo eliminar"),
  });

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-1">
          <span
            className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center"
            style={{ backgroundColor: `${category.category_color}20` }}
          >
            {icon ? (
              <SymbolicIcon name={icon} size={16} />
            ) : (
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: category.category_color }}
              />
            )}
          </span>
          <div>
            <h3 className="text-base font-semibold text-primary">{category.category_name}</h3>
            <p className="adw-caption adw-dim-label">
              {existing ? `Actual: ${formatCurrency(existing.amount)}` : "Sin presupuesto asignado"}
              {category.avg_monthly > 0 && ` · prom ${formatCurrency(category.avg_monthly)}/mes`}
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Límite mensual
            </label>
            <CurrencyInput value={value} onChange={(v) => setAmount(v)} placeholder="0,00" />
            {category.avg_monthly > 0 && (
              <button
                onClick={() => setAmount(Math.round(category.avg_monthly))}
                className="text-xs text-[var(--color-primary)] hover:underline font-medium mt-2"
              >
                Usar prom {formatCurrency(category.avg_monthly)}
              </button>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Grupo
            </label>
            <Select
              value={groupValue}
              onChange={(v) => setGroup(v)}
              options={[
                { value: "necesidades", label: "Necesidades" },
                { value: "gustos", label: "Gustos" },
                { value: "ahorro", label: "Ahorro" },
              ]}
            />
          </div>
        </div>
        {error && <p className="text-xs text-[var(--color-danger)] mt-3">{error}</p>}
        <div className="flex gap-2 mt-5">
          {existing && (
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending || saveMutation.isPending}
              className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--color-danger)] border border-[var(--color-danger)]/30 hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
          >
            Cancelar
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saveMutation.isPending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Help Panel (right slide-over, toggled by ?) ────────────────

function BudgetHelpPanel({ groups, onClose }: { groups: BudgetGroup[]; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: suggestionsData } = useQuery({
    queryKey: ["budget-suggestions"],
    queryFn: getBudgetSuggestions,
  });
  const { data: allCategories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => import("../api/client").then((m) => m.getCategories()),
  });

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["budget-summary"] });
    qc.invalidateQueries({ queryKey: ["budget-suggestions"] });
    qc.invalidateQueries({ queryKey: ["budget-groups"] });
  };

  const pending = (suggestionsData?.suggestions ?? []).filter(
    (s) => !s.has_budget && s.suggested > 0,
  );
  const groupOf = (categoryId: number) =>
    allCategories.find((c) => c.id === categoryId)?.budget_group ?? "necesidades";

  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const createMany = useMutation({
    mutationFn: async (items: BudgetSuggestion[]) => {
      const { createBudget } = await import("../api/client");
      const results = await Promise.allSettled(
        items.map((s) => createBudget({ category_id: s.category_id, amount: s.suggested })),
      );
      const done = results.filter((r) => r.status === "fulfilled").length;
      if (done === 0) throw new Error("No se pudo crear ningún presupuesto");
      return done;
    },
    onSuccess: (done) => {
      invalidate();
      setFeedback({ ok: true, text: `Se crearon ${done} presupuesto${done === 1 ? "" : "s"}.` });
    },
    onError: () => {
      setFeedback({ ok: false, text: "Algo falló al crear. Probá de nuevo." });
    },
  });

  const block = "text-xs text-[var(--text-secondary)] mt-1 leading-relaxed";
  const example =
    "mt-1.5 rounded-lg px-2.5 py-2 text-[11px] text-[var(--text-secondary)] bg-[var(--color-base)] border border-[var(--border-color)]";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[var(--color-surface)] border-l border-[var(--border-color)] shadow-xl overflow-y-auto animate-slide-in">
        <div className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-primary">Ayuda de presupuestos</h2>
            <button
              onClick={onClose}
              aria-label="Cerrar ayuda"
              className="w-8 h-8 rounded-lg hover:bg-[var(--color-base-alt)] flex items-center justify-center transition-colors text-lg text-[var(--text-tertiary)]"
            >
              ×
            </button>
          </div>
          <p className="adw-caption adw-dim-label mt-0.5">
            Lo esencial con ejemplos. El detalle vive en la Guía completa.
          </p>
        </div>

        <div className="px-5 py-4 space-y-5">
          <section>
            <p className="text-sm font-semibold text-primary">¿Qué es un presupuesto?</p>
            <p className={block}>
              Un límite mensual por categoría. Si te acercás, la fila te avisa antes de que se
              descontrole.
            </p>
            <p className={example}>
              Ej: Supermercado $120.000 → a los $96.000 (80%) ves <strong>Cuidado</strong>.
            </p>
          </section>

          <section>
            <p className="text-sm font-semibold text-primary">¿Para qué sirven?</p>
            <p className={block}>
              Para saber a mitad de mes si vas a llegar, decidir dónde recortar y separar ahorro con
              meta.
            </p>
            <p className={example}>
              Con presupuesto tenés: avisos al 80/100% · ritmo diario · reportes contra tu límite.
              Sin presupuesto, solo ves gastos y promedios.
            </p>
          </section>

          <section>
            <p className="text-sm font-semibold text-primary">Necesidades · Gustos · Ahorro</p>
            <p className={block}>
              Reparto orientativo 50/30/20 de tus ingresos, no una regla exacta.
            </p>
            <p className={example}>
              Ej con $500.000: Necesidades ~$250.000 (super, transporte, salud) · Gustos ~$150.000
              (salidas, delivery) · Ahorro ~$100.000.
            </p>
          </section>

          <section>
            <p className="text-sm font-semibold text-primary">Armá el tuyo en 3 pasos</p>
            <p className={block}>
              1. Asigná desde Sin asignar con un click (usa tu promedio). 2. Ajustá montos con el
              lápiz de cada fila. 3. Mirá el ritmo diario.
            </p>
          </section>

          <section>
            <p className="text-sm font-semibold text-primary">Generar desde promedios</p>
            <p className={block}>
              Creá todo lo sugerido de una vez, o completá por grupo. Con poco historial verás{" "}
              <em>evidencia limitada</em>: úsalo como punto de partida y ajustá el mes que viene.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                onClick={() => {
                  setFeedback(null);
                  createMany.mutate(pending);
                }}
                disabled={pending.length === 0 || createMany.isPending}
                className="px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] border border-[var(--color-primary)]/30 rounded-lg hover:bg-[var(--color-primary)]/10 transition-colors disabled:opacity-50"
              >
                {createMany.isPending ? "Creando..." : `Crear desde promedios (${pending.length})`}
              </button>
              {groups.map((g) => {
                const items = pending.filter((s) => groupOf(s.category_id) === g.name);
                if (items.length === 0) return null;
                const first = items[0];
                return (
                  <div key={g.name}>
                    <button
                      onClick={() => {
                        setFeedback(null);
                        createMany.mutate(items);
                      }}
                      disabled={createMany.isPending}
                      title={`Ej: ${first.category_name} ${formatCurrency(first.suggested)}`}
                      className="px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] border border-[var(--color-primary)]/30 rounded-lg hover:bg-[var(--color-primary)]/10 transition-colors disabled:opacity-50"
                    >
                      Completar {g.display_name} ({items.length})
                    </button>
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                      Ej: {first.category_name} {formatCurrency(first.suggested)}
                    </p>
                  </div>
                );
              })}
            </div>
            {pending.slice(0, 3).length > 0 && (
              <div
                aria-hidden="true"
                className="mt-2 rounded-lg px-2.5 py-2 border border-dashed border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5"
              >
                <p className="text-[11px] font-semibold text-[var(--text-tertiary)] mb-1">
                  Se crearían así:
                </p>
                {pending.slice(0, 3).map((s) => (
                  <div
                    key={s.category_id}
                    className="flex items-center justify-between text-xs py-0.5"
                  >
                    <span className="inline-flex items-center gap-2 text-[var(--text-primary)]">
                      <span
                        className="w-3 h-3 rounded-full inline-block"
                        style={{ backgroundColor: s.category_color }}
                      />
                      {s.category_name}
                    </span>
                    <strong>{formatCurrency(s.suggested)}</strong>
                  </div>
                ))}
                {pending.length > 3 && (
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                    +{pending.length - 3} más
                  </p>
                )}
              </div>
            )}
            {feedback && (
              <p
                className={`text-xs font-medium mt-2 ${
                  feedback.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
                }`}
              >
                {feedback.text}
              </p>
            )}
          </section>

          <section>
            <p className="text-sm font-semibold text-primary">Cómo leer cada fila</p>
            <p className={block}>
              Restante en verde = vas bien; Excedido en rojo = pasaste el límite. La barra y el %
              son contra tu presupuesto; el "prom" es tu media de 3 meses.
            </p>
          </section>

          <section>
            <p className="text-sm font-semibold text-primary">Ritmo diario y eventos</p>
            <p className={block}>
              El ritmo compara tu gasto por día contra el ideal según tu presupuesto. Dentro de
              banda = vas a cerrar bien el mes. Los eventos (vacaciones, mudanza) son presupuestos
              con fecha.
            </p>
          </section>

          <button
            onClick={() => {
              onClose();
              navigate("/guide/budgeting");
            }}
            className="text-xs text-[var(--color-primary)] hover:underline font-medium"
          >
            Guía completa de presupuestos →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Quick Config Modal ────────────────────────────────────────

// ─── Overview Modal: everything budgeted + unassigned with spending ─

function QuickConfigModal({
  onClose,
  onEditCategory,
}: {
  onClose: () => void;
  onEditCategory: (cat: BudgetSummaryItem) => void;
}) {
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
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const catById = new Map(allCategories.map((c) => [c.id, c]));
  const parentNameOf = (cat: (typeof allCategories)[number]) =>
    cat.parent_id ? (catById.get(cat.parent_id)?.name ?? null) : null;

  // Context per category from summary (spent MTD + avg + evidence + status)
  const summaryMap = new Map<
    number,
    { spent: number; avg: number; months: number; budget: number; status: string }
  >();
  for (const p of summary?.categories ?? []) {
    for (const ch of [p, ...p.children]) {
      if (ch.category_id !== null && !summaryMap.has(ch.category_id)) {
        summaryMap.set(ch.category_id, {
          spent: ch.spent_amount,
          avg: ch.avg_monthly,
          months: ch.months_with_data,
          budget: ch.budget_amount,
          status: ch.status,
        });
      }
    }
  }

  type Row = {
    key: number;
    name: string;
    parent: string | null;
    color: string;
    budget: number;
    spent: number;
    avg: number;
    months: number;
    status: string;
    group: string;
    hasBudget: boolean;
  };

  const budgetedRows: Row[] = [];
  for (const b of budgets) {
    const cat = catById.get(b.category_id);
    const ctx = summaryMap.get(b.category_id);
    budgetedRows.push({
      key: b.category_id,
      name: cat?.name ?? "Categoría eliminada",
      parent: cat ? parentNameOf(cat) : null,
      color: cat?.color ?? "#71717a",
      budget: b.amount,
      spent: ctx?.spent ?? 0,
      avg: ctx?.avg ?? 0,
      months: ctx?.months ?? 0,
      status: ctx?.status ?? (b.amount > 0 ? "ok" : "no_budget"),
      group: cat?.budget_group ?? "necesidades",
      hasBudget: true,
    });
  }

  const budgetedIds = new Set(budgets.map((b) => b.category_id));
  const unassignedRows: Row[] = [];
  for (const cat of allCategories) {
    const isLeaf = !allCategories.some((p) => p.parent_id === cat.id);
    if (!isLeaf || budgetedIds.has(cat.id)) continue;
    const ctx = summaryMap.get(cat.id);
    if (!ctx || (ctx.spent <= 0 && ctx.avg <= 0)) continue;
    unassignedRows.push({
      key: cat.id,
      name: cat.name,
      parent: parentNameOf(cat),
      color: cat.color,
      budget: 0,
      spent: ctx.spent,
      avg: ctx.avg,
      months: ctx.months,
      status: "no_budget",
      group: cat.budget_group || "necesidades",
      hasBudget: false,
    });
  }

  const q = searchQuery.trim().toLowerCase();
  const match = (r: Row) =>
    !q || r.name.toLowerCase().includes(q) || (r.parent ?? "").toLowerCase().includes(q);
  const budgeted = budgetedRows.filter(match).sort((a, b) => b.budget - a.budget);
  const unassigned = unassignedRows.filter(match).sort((a, b) => b.avg - a.avg);
  const totalAssigned = budgetedRows.reduce((s, r) => s + r.budget, 0);

  const toEditItem = (r: Row): BudgetSummaryItem => ({
    category_id: r.key,
    category_name: r.name,
    category_color: r.color,
    budget_group: r.group,
    budget_amount: r.budget,
    spent_amount: r.spent,
    avg_monthly: r.avg,
    months_with_data: r.months,
    percentage: 0,
    status: r.status as BudgetSummaryItem["status"],
    has_budget: r.hasBudget,
    children: [],
  });

  const statusColor = (s: string) =>
    s === "exceeded"
      ? "var(--color-danger)"
      : s === "warning"
        ? "var(--color-warning)"
        : s === "ok"
          ? "var(--color-success)"
          : "var(--text-tertiary)";

  const renderRow = (r: Row) => {
    const icon = getCategoryIcon(r.name);
    const remaining = r.budget - r.spent;
    return (
      <div
        key={r.key}
        className="py-2.5 px-3 rounded-lg hover:bg-[var(--color-base-alt)] transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
              style={{ backgroundColor: `${r.color}20` }}
            >
              {icon ? (
                <SymbolicIcon name={icon} size={14} />
              ) : (
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {r.parent ? `${r.parent} > ${r.name}` : r.name}
              </p>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                {r.hasBudget ? (
                  <>
                    {formatCurrency(r.budget)} presup. · gastado {formatCurrency(r.spent)}
                    {r.avg > 0 && <> · prom {formatCurrency(r.avg)}</>}
                    {r.months < 3 && " · poco historial"}
                  </>
                ) : (
                  <>
                    gastado {formatCurrency(r.spent)}
                    {r.avg > 0 && <> · prom {formatCurrency(r.avg)}</>}
                    {r.months < 3 && " · poco historial"}
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {r.hasBudget && (
              <span
                className="text-xs font-semibold"
                style={{
                  color: remaining < 0 ? "var(--color-danger)" : "var(--color-success)",
                }}
              >
                {remaining >= 0
                  ? `${formatCurrency(remaining)} rest.`
                  : `-${formatCurrency(Math.abs(remaining))}`}
              </span>
            )}
            <span
              className="w-2 h-2 rounded-full inline-block"
              title={r.status}
              style={{ backgroundColor: statusColor(r.status) }}
            />
            <button
              onClick={() => onEditCategory(toEditItem(r))}
              title={r.hasBudget ? `Editar ${r.name}` : `Asignar presupuesto a ${r.name}`}
              aria-label={r.hasBudget ? `Editar ${r.name}` : `Asignar presupuesto a ${r.name}`}
              className="h-7 px-2 rounded-lg text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors"
            >
              {r.hasBudget ? "Editar" : "Asignar"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-primary mb-1">Todo lo presupuestado</h3>
        <p className="adw-caption adw-dim-label mb-4">
          {budgeted.length} con presupuesto · {unassigned.length} con gasto sin asignar · total{" "}
          {formatCurrency(totalAssigned)}
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
        {budgeted.length === 0 && unassigned.length === 0 ? (
          <EmptyState
            icon="cash"
            title="Sin presupuestos ni gastos"
            description="Creá tu primer presupuesto desde una categoría con gasto o desde cero."
            action={{ label: "Cerrar", onClick: onClose }}
          />
        ) : (
          <>
            {budgeted.length > 0 && (
              <div className="mb-5">
                <p className="adw-caption-heading adw-dim-label px-1 mb-1.5">PRESUPUESTADAS</p>
                <div className="rounded-xl border border-[var(--border-color)] overflow-hidden">
                  {budgeted.map(renderRow)}
                </div>
              </div>
            )}
            {unassigned.length > 0 && (
              <div>
                <p className="adw-caption-heading adw-dim-label px-1 mb-1.5">SIN ASIGNAR</p>
                <div className="rounded-xl border border-[var(--border-color)] overflow-hidden">
                  {unassigned.map(renderRow)}
                </div>
              </div>
            )}
          </>
        )}
        <div className="sticky bottom-0 bg-[var(--color-surface)] pt-3 pb-1 mt-4 border-t border-[var(--border-color)]">
          <div className="flex gap-2">
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="px-6 py-2 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
            >
              Cerrar
            </button>
          </div>
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

  // Amounts are the source of truth; percentages derive from the total
  // assigned. `edited` only holds user-typed values so async loads can't
  // go stale.
  const [edited, setEdited] = useState<Record<string, number>>({});

  const amountOf = (name: string) => {
    if (edited[name] !== undefined) return edited[name];
    return allGroups.find((g) => g.name === name)?.amount ?? 0;
  };
  const total = allGroups.reduce((s, g) => s + amountOf(g.name), 0);
  const pctOf = (name: string) => (total > 0 ? (amountOf(name) / total) * 100 : 0);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { updateBudgetGroup } = await import("../api/client");
      const promises = [];
      for (const g of allGroups) {
        promises.push(
          updateBudgetGroup(g.id, {
            percentage: Math.round(pctOf(g.name) * 10) / 10,
            amount: amountOf(g.name),
          }),
        );
      }
      return Promise.all(promises);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget-groups"] });
      qc.invalidateQueries({ queryKey: ["budget-summary"] });
      onClose();
    },
  });

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-primary mb-1">Editar grupos</h3>
        <p className="adw-caption adw-dim-label mb-4">
          Definí los montos. Como guía, la relación entre grupos conviene que ronde el 50/30/20 de
          tus ingresos (no hace falta que sea exacta).
        </p>
        <div className="space-y-4">
          {allGroups.map((g) => (
            <div key={g.name} className="p-3 rounded-lg border border-[var(--border-color)]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-primary">{g.display_name}</p>
                <span className="text-xs text-[var(--text-tertiary)]">
                  ~= {pctOf(g.name).toFixed(1)}%
                </span>
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-secondary)] mb-1">
                  Monto mensual
                </label>
                <input
                  type="number"
                  value={edited[g.name] ?? g.amount ?? ""}
                  onChange={(e) =>
                    setEdited({ ...edited, [g.name]: parseFloat(e.target.value) || 0 })
                  }
                  placeholder="0"
                  className="input w-full text-xs"
                />
              </div>
            </div>
          ))}
          <p className="text-xs text-[var(--text-secondary)] text-center">
            Total asignado: <strong>{formatCurrency(total)}</strong>
          </p>
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
  const [editingCategory, setEditingCategory] = useState<BudgetSummaryItem | null>(null);
  const [showHelp, setShowHelp] = useState(false);
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
  const expectedToday = budgetPace * dayOfMonth;
  const paceRatio = expectedToday > 0 ? totalSpent / expectedToday : 0;
  const paceColor =
    paceRatio <= 1
      ? "var(--color-success)"
      : paceRatio <= 1.1
        ? "var(--color-warning)"
        : "var(--color-danger)";
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
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div>
          <h1 className="adw-title-2 text-primary">Presupuesto</h1>
          <p className="adw-caption adw-dim-label">{monthLabel} · montos en ARS</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowHelp((v) => !v)}
            title="Ayuda sobre presupuestos"
            aria-label="Ayuda sobre presupuestos"
            aria-expanded={showHelp}
            aria-controls="budget-help-panel"
            className={`w-11 h-11 rounded-full border border-[var(--border-color)] bg-[var(--color-surface)] text-lg font-semibold transition-colors shadow-sm ${
              showHelp
                ? "text-[var(--color-primary)] border-[var(--color-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)]"
            }`}
          >
            ?
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
              <p className="adw-caption adw-dim-label mt-1">
                esperado a hoy {formatCurrency(expectedToday)} · real {formatCurrency(totalSpent)}
              </p>
              <div className="h-2 bg-[var(--color-base-alt)] rounded-full overflow-hidden mt-2">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(paceRatio * 100, 100)}%`,
                    backgroundColor: paceColor,
                  }}
                />
              </div>
              <p className={`adw-caption mt-1 ${paceOk ? "text-success" : "text-warning"}`}>
                {paceOk ? "dentro de banda" : "por encima del ritmo"}
              </p>
            </div>
          </div>

          {/* Category Groups */}
          <div className="mb-6 space-y-4">
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
                    onCategoryEdit={setEditingCategory}
                    onEditGroup={() => setEditingGroup(groups[0])}
                  />
                ))}
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowQuickConfig(true)}
                    className="text-xs text-[var(--color-primary)] hover:underline font-medium"
                  >
                    Ver todo lo presupuestado →
                  </button>
                </div>
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
      {showQuickConfig && (
        <QuickConfigModal
          onClose={() => setShowQuickConfig(false)}
          onEditCategory={(cat) => {
            setShowQuickConfig(false);
            setEditingCategory(cat);
          }}
        />
      )}
      {editingGroup && <EditGroupModal onClose={() => setEditingGroup(null)} />}
      {selectedCategory && (
        <CategorySidePanel category={selectedCategory} onClose={() => setSelectedCategory(null)} />
      )}
      {editingCategory && (
        <EditBudgetModal category={editingCategory} onClose={() => setEditingCategory(null)} />
      )}
      {showHelp && (
        <div id="budget-help-panel">
          <BudgetHelpPanel groups={groups} onClose={() => setShowHelp(false)} />
        </div>
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
