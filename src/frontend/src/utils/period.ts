/**
 * Shared period contract (`?month=YYYY-MM`).
 *
 * Dashboard, Budget and Expenses all describe the same month. The URL is the
 * source of truth when it carries a valid month; otherwise the last month the
 * user picked is restored from sessionStorage so navigating between screens
 * with the app shell (which does not carry query strings) keeps the period.
 */

export const PERIOD_MONTH_STORAGE_KEY = "oikonomia_period_month";

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function isMonth(value: string | null | undefined): value is string {
  return typeof value === "string" && MONTH_RE.test(value);
}

/** Returns the value only when it is a real `YYYY-MM`, so bad links fall back. */
export function parseMonth(value: string | null | undefined): string | undefined {
  return isMonth(value) ? value : undefined;
}

export function shiftMonth(month: string, delta: number): string {
  const match = MONTH_RE.exec(month);
  if (!match) return currentMonth();
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1 + delta;
  const shifted = new Date(year, monthIndex, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonth(month: string): string {
  const match = MONTH_RE.exec(month);
  if (!match) return month;
  return `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`;
}

export function readStoredMonth(): string | undefined {
  try {
    return parseMonth(sessionStorage.getItem(PERIOD_MONTH_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function persistMonth(month: string): void {
  if (!isMonth(month)) return;
  try {
    sessionStorage.setItem(PERIOD_MONTH_STORAGE_KEY, month);
  } catch {
    /* private mode or quota — the URL still carries the period for this view */
  }
}
