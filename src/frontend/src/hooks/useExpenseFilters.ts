import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

export interface ExpenseFilters {
  /** Selected categories. Empty means no category filter; `uncategorized` is separate. */
  categoryIds: number[];
  uncategorized: boolean;
  person: string | undefined;
  dateFrom: string | undefined;
  dateTo: string | undefined;
  tagId: number | undefined;
  untagged: boolean;
  cuentaId: number | undefined;
  sinCuenta: boolean;
  q: string | undefined;
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * `category_ids` is the multi-select contract (comma separated). `category_id`
 * is still read as a one-item selection because links written before the
 * multi-select existed — the category dashboard's, for instance — are in the
 * wild and must keep filtering.
 */
function parseCategoryIds(params: URLSearchParams): number[] {
  const raw = params.get("category_ids") ?? params.get("category_id") ?? "";
  const ids = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

export function useExpenseFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: ExpenseFilters = {
    categoryIds: parseCategoryIds(searchParams),
    uncategorized: searchParams.get("uncategorized") === "1",
    person: searchParams.get("person") || undefined,
    dateFrom: searchParams.get("date_from") || undefined,
    dateTo: searchParams.get("date_to") || undefined,
    tagId: searchParams.get("tag_id") ? parseInt(searchParams.get("tag_id")!) : undefined,
    untagged: searchParams.get("untagged") === "1",
    cuentaId: searchParams.get("cuenta_id") ? parseInt(searchParams.get("cuenta_id")!) : undefined,
    sinCuenta: searchParams.get("sin_cuenta") === "1",
    q: searchParams.get("q") || undefined,
  };

  const setFilter = useCallback(
    (key: string, value: string | undefined) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set(key, value);
      else next.delete(key);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const clearFilters = useCallback(() => setSearchParams(new URLSearchParams()), [setSearchParams]);

  /**
   * Replace the whole category selection. Writing the list normalizes the URL:
   * the legacy `category_id` goes away, and choosing categories is mutually
   * exclusive with "sin categoría".
   */
  const setCategoryIds = useCallback(
    (ids: number[]) => {
      const next = new URLSearchParams(searchParams);
      const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
      next.delete("category_id");
      if (unique.length > 0) {
        next.set("category_ids", unique.join(","));
        next.delete("uncategorized");
      } else {
        next.delete("category_ids");
        // Clearing the selection means no category filter at all, including
        // "sin categoría" — otherwise the empty state looks like a filter.
        next.delete("uncategorized");
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  // Free-text search: the field is local, but the URL (and therefore the
  // fetch) settles SEARCH_DEBOUNCE_MS after the last keystroke.
  const [searchInput, setSearchInput] = useState(filters.q ?? "");

  // Keep the field in sync when q changes from outside (browser back, clearFilters)
  useEffect(() => {
    setSearchInput(filters.q ?? "");
  }, [filters.q]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === (filters.q ?? "")) return;
    const timer = setTimeout(() => setFilter("q", trimmed || undefined), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, filters.q, setFilter]);

  return {
    filters,
    setFilter,
    setCategoryIds,
    clearFilters,
    searchParams,
    setSearchParams,
    searchInput,
    setSearchInput,
  };
}
