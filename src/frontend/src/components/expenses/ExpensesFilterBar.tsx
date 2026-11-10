import { useMemo } from "react";
import type { ExpenseFilters } from "../../hooks/useExpenseFilters";
import type { Category, Tag } from "../../types";
import type { FilterChip } from "../../utils/expenseFilterChips";
import { categoryGroupOptions } from "../../utils/format";
import SymbolicIcon from "../SymbolicIcon";
import { DateRangePicker, type DateRangeValue } from "../ui/DateRangePicker";
import { MultiSelect } from "../ui/MultiSelect";
import { Select } from "../ui/Select";
import { SavedViewsMenu } from "./SavedViewsMenu";

interface ExpensesFilterBarProps {
  filters: ExpenseFilters;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  categories: Category[];
  tags: Tag[];
  chips: FilterChip[];
  /** Live count shown under the search box. Empty hides the line. */
  resultSummary: string;
  onCategoryChange: (values: string[]) => void;
  onCuentaChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onDateRangeChange: (range: DateRangeValue) => void;
  onClearChip: (chip: FilterChip) => void;
  onClearAll: () => void;
  /** Serialized current filters, for saving a view. */
  searchParams: URLSearchParams;
  onApplyView: (params: URLSearchParams) => void;
}

const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--color-base-alt)] px-2 py-0.5 text-xs text-[var(--text-primary)]";

/**
 * The whole filter surface: search, the expandable field grid and the chips.
 * Every control shares `.filter-control`, so heights and focus rings cannot
 * drift apart again.
 */
export function ExpensesFilterBar({
  filters,
  searchInput,
  onSearchInputChange,
  expanded,
  onToggleExpanded,
  categories,
  tags,
  chips,
  resultSummary,
  onCategoryChange,
  onCuentaChange,
  onTagChange,
  onDateRangeChange,
  onClearChip,
  onClearAll,
  searchParams,
  onApplyView,
}: ExpensesFilterBarProps) {
  const categoryGroups = useMemo(() => categoryGroupOptions(categories), [categories]);

  const cuentaOptions = useMemo(
    () => [
      { value: "__sin_cuenta__", label: "Sin cuenta" },
      ...tags
        .filter((tag) => tag.group_name === "cuenta")
        .map((tag) => ({ value: String(tag.id), label: tag.name })),
    ],
    [tags],
  );

  const tagOptions = useMemo(
    () => [
      { value: "__untagged__", label: "Sin etiqueta" },
      ...tags
        .filter((tag) => tag.group_name === "otros")
        .map((tag) => ({ value: String(tag.id), label: tag.name })),
    ],
    [tags],
  );

  const cuentaValue = filters.sinCuenta
    ? "__sin_cuenta__"
    : filters.cuentaId
      ? String(filters.cuentaId)
      : "";

  const tagValue = filters.untagged ? "__untagged__" : filters.tagId ? String(filters.tagId) : "";

  return (
    <div className={`card ${expanded ? "" : "sticky top-0 z-20"}`} data-testid="expense-filters">
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => onSearchInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onSearchInputChange("");
              }}
              placeholder="Buscar por descripción, nota o categoría…"
              aria-label="Buscar gastos"
              className="filter-input pl-8 pr-8 text-sm"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tertiary">
              <SymbolicIcon name="search" size={14} />
            </span>
            {searchInput && (
              <button
                type="button"
                onClick={() => onSearchInputChange("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-tertiary transition hover:text-primary"
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-controls="expense-filter-fields"
            className="filter-control w-auto shrink-0 justify-center px-3"
          >
            <span className="flex items-center gap-1.5">
              Filtros
              {chips.length > 0 && (
                <span className="rounded-full bg-[var(--color-primary)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--color-on-primary)]">
                  {chips.length}
                </span>
              )}
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
                className={`transition-transform ${expanded ? "rotate-180" : ""}`}
              >
                <path
                  d="M3 4.5L6 7.5L9 4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
          <SavedViewsMenu searchParams={searchParams} onApply={onApplyView} />
        </div>

        {resultSummary && (
          <p className="text-xs text-secondary" aria-live="polite">
            {resultSummary}
          </p>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <span key={chip.key} className={CHIP_CLASS}>
                {chip.label}
                <button
                  type="button"
                  onClick={() => onClearChip(chip)}
                  aria-label={`Quitar filtro ${chip.label}`}
                  className="text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]"
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={onClearAll}
              className="inline-flex items-center rounded-full border border-[var(--color-primary)] px-2 py-0.5 text-xs text-[var(--color-primary)] transition hover:bg-[var(--color-primary)]/10"
            >
              Limpiar ({chips.length})
            </button>
          </div>
        )}

        {expanded && (
          <div id="expense-filter-fields" className="border-t border-[var(--border-color)] pt-3">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <MultiSelect
                values={filters.uncategorized ? ["__none__"] : filters.categoryIds.map(String)}
                onChange={onCategoryChange}
                options={[{ value: "__none__", label: "Sin categoría" }]}
                groups={categoryGroups}
                placeholder="Todas las categorías"
                ariaLabel="Categoría"
              />

              <Select
                value={cuentaValue}
                onChange={onCuentaChange}
                options={cuentaOptions}
                placeholder="Todas las cuentas"
                ariaLabel="Cuenta"
              />

              <Select
                value={tagValue}
                onChange={onTagChange}
                options={tagOptions}
                placeholder="Todas las etiquetas"
                ariaLabel="Etiqueta"
              />

              <DateRangePicker
                preset={filters.datePreset}
                from={filters.dateFrom}
                to={filters.dateTo}
                month={filters.month}
                onChange={onDateRangeChange}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
