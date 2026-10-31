/**
 * Relative date windows for the expenses filter.
 *
 * Presets are calendar-month aligned on purpose: the rest of the app compares
 * months (budgets, dashboard deltas, the category dashboard links that arrive
 * as `month=YYYY-MM`). A rolling 30-day window would cut months in half and
 * make a "3 months" KPI drift without a single expense changing.
 */

export type DateRangePreset = "1m" | "2m" | "3m" | "6m" | "12m";

export const DATE_RANGE_PRESETS: DateRangePreset[] = ["1m", "2m", "3m", "6m", "12m"];

export interface DateRange {
  from: string;
  to: string;
}

const PRESET_MONTHS: Record<DateRangePreset, number> = {
  "1m": 1,
  "2m": 2,
  "3m": 3,
  "6m": 6,
  "12m": 12,
};

export function parseDateRangePreset(value: string | null): DateRangePreset | undefined {
  return DATE_RANGE_PRESETS.find((preset) => preset === value);
}

export function presetMonths(preset: DateRangePreset): number {
  return PRESET_MONTHS[preset];
}

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** First day of the window to today, both ends inclusive. */
export function presetRange(preset: DateRangePreset, today: Date = new Date()): DateRange {
  const months = presetMonths(preset);
  const from = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  return { from: toISODate(from), to: toISODate(today) };
}

/** `month=YYYY-MM` → its first and last day. Invalid values return null. */
export function monthRange(month: string): DateRange | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  if (monthIndex < 1 || monthIndex > 12) return null;
  const lastDay = new Date(year, monthIndex, 0).getDate();
  return {
    from: `${year}-${String(monthIndex).padStart(2, "0")}-01`,
    to: `${year}-${String(monthIndex).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function presetLabel(preset: DateRangePreset): string {
  return preset === "1m" ? "Este mes" : `Últimos ${presetMonths(preset)} meses`;
}
