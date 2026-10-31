import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  monthRange,
  parseDateRangePreset,
  presetRange,
  type DateRangePreset,
} from "../utils/dateRange";

export interface ExpenseFilters {
  /** Selected categories. Empty means no category filter; `uncategorized` is separate. */
  categoryIds: number[];
  uncategorized: boolean;
  person: string | undefined;
  dateFrom: string | undefined;
  dateTo: string | undefined;
  /** Relative preset in force, if the user chose one. */
  datePreset: DateRangePreset | undefined;
  /** `month=YYYY-MM` arriving from the category dashboard, if any. */
  month: string | undefined;
  tagId: number | undefined;
  untagged: boolean;
  cuentaId: number | undefined;
  sinCuenta: boolean;
  q: string | undefined;
}

const SEARCH_DEBOUNCE_MS = 300;

/** Last applied filter set, per tab. */
export const EXPENSES_FILTERS_KEY = "expenses_filters";

function sanitizeFilterParams(params: URLSearchParams): URLSearchParams {
  const clean = new URLSearchParams(params);
  // A notification's scroll target is not a filter: restoring it would keep
  // the transient flag alive on every visit.
  clean.delete("category_suggestions");
  return clean;
}

export function readStoredFilters(): URLSearchParams | null {
  try {
    const raw = sessionStorage.getItem(EXPENSES_FILTERS_KEY);
    if (!raw) return null;
    const clean = sanitizeFilterParams(new URLSearchParams(raw));
    return clean.toString() ? clean : null;
  } catch {
    return null;
  }
}

export function persistFilters(params: URLSearchParams): void {
  try {
    const clean = sanitizeFilterParams(params);
    if (clean.toString()) sessionStorage.setItem(EXPENSES_FILTERS_KEY, clean.toString());
    else sessionStorage.removeItem(EXPENSES_FILTERS_KEY);
  } catch {
    /* private mode or quota — filters still work for this page view */
  }
}

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

  /**
   * Restore the previous session's filters only on the first mount, and only
   * when the URL arrives empty. An explicit link (category dashboard, a shared
   * URL) always wins and becomes the new persisted state.
   */
  const pendingRestore = useRef<URLSearchParams | null>(
    searchParams.toString() ? null : readStoredFilters(),
  );
  const [restoring, setRestoring] = useState(Boolean(pendingRestore.current));

  useEffect(() => {
    const stored = pendingRestore.current;
    if (!stored) return;
    pendingRestore.current = null;
    setSearchParams(stored, { replace: true });
  }, [setSearchParams]);

  // The flag clears only once the restored params are actually in the URL, so
  // the persistence effect below can never write the empty first render.
  useEffect(() => {
    if (!restoring) return;
    if (searchParams.toString() !== "") setRestoring(false);
  }, [restoring, searchParams]);

  const datePreset = parseDateRangePreset(searchParams.get("range"));
  const month = searchParams.get("month") || undefined;
  const monthDates = !datePreset && month ? monthRange(month) : null;
  const presetDates = datePreset ? presetRange(datePreset) : null;

  const filters: ExpenseFilters = {
    categoryIds: parseCategoryIds(searchParams),
    uncategorized: searchParams.get("uncategorized") === "1",
    person: searchParams.get("person") || undefined,
    dateFrom: presetDates?.from ?? searchParams.get("date_from") ?? monthDates?.from ?? undefined,
    dateTo: presetDates?.to ?? searchParams.get("date_to") ?? monthDates?.to ?? undefined,
    datePreset,
    month,
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

  /**
   * A preset is stored as `range=3m`, not as frozen dates: tomorrow "3m" must
   * still mean the last three calendar months. Custom ranges store dates.
   */
  const setDateRange = useCallback(
    (range: { preset?: DateRangePreset; from?: string; to?: string }) => {
      const next = new URLSearchParams(searchParams);
      next.delete("month");
      next.delete("range");
      next.delete("date_from");
      next.delete("date_to");
      if (range.preset) {
        next.set("range", range.preset);
      } else {
        if (range.from) next.set("date_from", range.from);
        if (range.to) next.set("date_to", range.to);
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const clearDateRange = useCallback(() => setDateRange({}), [setDateRange]);

  // Persist on every settled change. The restore runs first (layout effect), so
  // the empty first render can never overwrite what we are about to restore.
  useEffect(() => {
    if (restoring) return;
    persistFilters(searchParams);
  }, [searchParams, restoring]);

  // `restoring` is only true until the layout effect has navigated. The extra
  // guard covers a render that lands between the state update and the router's.
  const ready = !restoring || searchParams.toString().length > 0;

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
    setDateRange,
    clearDateRange,
    clearFilters,
    ready,
    searchParams,
    setSearchParams,
    searchInput,
    setSearchInput,
  };
}
