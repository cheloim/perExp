import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  PERIOD_ALL,
  currentMonth,
  parseMonth,
  parsePeriod,
  persistLastMonth,
  persistPeriod,
  readLastMonth,
  readStoredPeriod,
  shiftMonth,
} from "../utils/period";

/**
 * Active period shared by Dashboard, Budget and Expenses.
 *
 * Precedence: explicit `?month=` / `?period=all` in the URL, then the last
 * stored period, then the current calendar month. Selecting a period writes it
 * to both the URL and sessionStorage, and drops any explicit date range so the
 * period is the filter actually in force.
 *
 * `month` is undefined on all-history: filters must omit it, not send an empty
 * month. `anchorMonth` is the last concrete month, used by the navigator arrows
 * and by the screens whose numbers are still monthly by definition.
 */
export function usePeriod() {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlPeriod = parsePeriod(searchParams.get("period"));
  const urlMonth = parseMonth(searchParams.get("month"));
  const period = urlPeriod ?? urlMonth ?? readStoredPeriod() ?? currentMonth();
  const month = parseMonth(period);
  const isAllHistory = period === PERIOD_ALL;
  const anchorMonth = month ?? readLastMonth() ?? currentMonth();

  useEffect(() => {
    persistPeriod(period);
    if (month) persistLastMonth(month);
  }, [period, month]);

  const setPeriod = useCallback(
    (next: string) => {
      const parsed = parsePeriod(next);
      if (!parsed) return;
      persistPeriod(parsed);
      const params = new URLSearchParams(searchParams);
      // An explicit preset/custom range would otherwise win over the period.
      params.delete("range");
      params.delete("date_from");
      params.delete("date_to");
      if (parsed === PERIOD_ALL) {
        params.set("period", PERIOD_ALL);
        params.delete("month");
      } else {
        persistLastMonth(parsed);
        params.delete("period");
        params.set("month", parsed);
      }
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const setMonth = useCallback((next: string) => setPeriod(next), [setPeriod]);
  const showAllHistory = useCallback(() => setPeriod(PERIOD_ALL), [setPeriod]);

  return {
    period,
    month,
    isAllHistory,
    anchorMonth,
    setPeriod,
    setMonth,
    showAllHistory,
    previousMonth: useCallback(
      () => setPeriod(shiftMonth(anchorMonth, -1)),
      [anchorMonth, setPeriod],
    ),
    nextMonth: useCallback(() => setPeriod(shiftMonth(anchorMonth, 1)), [anchorMonth, setPeriod]),
    isCurrentMonth: month === currentMonth(),
  };
}
