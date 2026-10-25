import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

export interface ExpenseFilters {
  categoryId: number | undefined;
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

export function useExpenseFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: ExpenseFilters = {
    categoryId: searchParams.get("category_id")
      ? parseInt(searchParams.get("category_id")!)
      : undefined,
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
    clearFilters,
    searchParams,
    setSearchParams,
    searchInput,
    setSearchInput,
  };
}
