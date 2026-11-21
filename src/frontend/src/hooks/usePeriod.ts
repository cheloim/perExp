import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  currentMonth,
  parseMonth,
  persistMonth,
  readStoredMonth,
  shiftMonth,
} from "../utils/period";

/**
 * Active period shared by Dashboard, Budget and Expenses.
 *
 * Precedence: explicit `?month=` in the URL, then the last stored selection,
 * then the current calendar month. Selecting a month writes it to both the URL
 * and sessionStorage, and drops any explicit date range so the month is the
 * filter actually in force.
 */
export function usePeriod() {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlMonth = parseMonth(searchParams.get("month"));
  const month = urlMonth ?? readStoredMonth() ?? currentMonth();

  useEffect(() => {
    persistMonth(month);
  }, [month]);

  const setMonth = useCallback(
    (next: string) => {
      if (!parseMonth(next)) return;
      persistMonth(next);
      const params = new URLSearchParams(searchParams);
      params.set("month", next);
      // An explicit preset/custom range would otherwise win over `month`.
      params.delete("range");
      params.delete("date_from");
      params.delete("date_to");
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  return {
    month,
    setMonth,
    previousMonth: useCallback(() => setMonth(shiftMonth(month, -1)), [month, setMonth]),
    nextMonth: useCallback(() => setMonth(shiftMonth(month, 1)), [month, setMonth]),
    isCurrentMonth: month === currentMonth(),
  };
}
