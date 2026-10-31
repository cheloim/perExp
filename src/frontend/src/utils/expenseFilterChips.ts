import type { ExpenseFilters } from "../hooks/useExpenseFilters";
import type { Category, Tag } from "../types";
import { formatDateDMY } from "./format";
import { presetLabel } from "./dateRange";

export type FilterChipKind =
  | "search"
  | "category"
  | "uncategorized"
  | "cuenta"
  | "sin_cuenta"
  | "tag"
  | "untagged"
  | "date"
  | "person";

export interface FilterChip {
  key: string;
  label: string;
  kind: FilterChipKind;
  value?: string | number;
}

/**
 * Active filters as removable chips, in the same order they are applied.
 * The chip count is also the "Limpiar (n)" number: a multi-category selection
 * is one filter, not one per category.
 */
export function buildFilterChips(
  filters: ExpenseFilters,
  categories: Category[],
  tags: Tag[],
): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.q) {
    chips.push({ key: "q", label: `«${filters.q}»`, kind: "search" });
  }

  for (const id of filters.categoryIds) {
    chips.push({
      key: `category-${id}`,
      label: categories.find((category) => category.id === id)?.name ?? "Categoría",
      kind: "category",
      value: id,
    });
  }
  if (filters.uncategorized) {
    chips.push({ key: "uncategorized", label: "Sin categoría", kind: "uncategorized" });
  }

  if (filters.cuentaId) {
    chips.push({
      key: "cuenta",
      label: tags.find((tag) => tag.id === filters.cuentaId)?.name ?? "Cuenta",
      kind: "cuenta",
      value: filters.cuentaId,
    });
  }
  if (filters.sinCuenta) {
    chips.push({ key: "sin_cuenta", label: "Sin cuenta", kind: "sin_cuenta" });
  }

  if (filters.tagId) {
    chips.push({
      key: "tag",
      label: tags.find((tag) => tag.id === filters.tagId)?.name ?? "Etiqueta",
      kind: "tag",
      value: filters.tagId,
    });
  }
  if (filters.untagged) {
    chips.push({ key: "untagged", label: "Sin etiqueta", kind: "untagged" });
  }

  if (filters.dateFrom || filters.dateTo) {
    chips.push({
      key: "date_range",
      label: filters.datePreset
        ? presetLabel(filters.datePreset)
        : `${filters.dateFrom ? formatDateDMY(filters.dateFrom) : "…"} – ${
            filters.dateTo ? formatDateDMY(filters.dateTo) : "…"
          }`,
      kind: "date",
    });
  }

  if (filters.person) {
    chips.push({
      key: "person",
      label: `Titular: ${filters.person}`,
      kind: "person",
      value: filters.person,
    });
  }

  return chips;
}
