import type { QueryClient } from "@tanstack/react-query";

/**
 * Query keys for the expenses page, in one place.
 *
 * The optimistic update used to build its own array while the list query used
 * a joined `filterKey` string, so the two keys never matched: a category change
 * waited for the network instead of landing in the row immediately.
 */
export const expenseQueryKeys = {
  listBase: ["expenses-list"] as const,
  list: (filterKey: string, visibleCount: number) =>
    ["expenses-list", filterKey, visibleCount] as const,
  stats: (filterKey: string) => ["expense-stats", filterKey] as const,
  byPerson: (filterKey: string) => ["expenses-by-person", filterKey] as const,
};

const ANALYTICS_QUERY_KEYS = [["expense-stats"], ["expenses-by-person"]] as const;

/**
 * Invalidate the table AND every number derived from the same rows. Refreshing
 * only the list left the KPI cards and charts stale after a category change
 * until the filters happened to change.
 */
export function invalidateExpenseQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: expenseQueryKeys.listBase });
  for (const queryKey of ANALYTICS_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey });
  }
}
