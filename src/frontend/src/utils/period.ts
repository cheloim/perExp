/**
 * Shared period contract (`?month=YYYY-MM` or `?period=all`).
 *
 * Dashboard, Budget and Expenses all describe the same period. The URL is the
 * source of truth when it carries a valid month or the explicit all-history
 * flag; otherwise the last period the user picked is restored from
 * sessionStorage so navigating between screens with the app shell (which does
 * not carry query strings) keeps the period.
 *
 * "All history" is its own state, not an empty month: the caller must be able
 * to tell "the user chose everything" apart from "no month picked yet", and
 * the navigator can say so out loud.
 */

export const PERIOD_MONTH_STORAGE_KEY = "oikonomia_period_month";
/** Last concrete month, so leaving all-history lands on the month the user had. */
export const PERIOD_LAST_MONTH_STORAGE_KEY = "oikonomia_period_last_month";
export const PERIOD_ALL = "all";
export const ALL_HISTORY_LABEL = "Todo el historial";

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

/** Accepts a real month or the explicit all-history flag. */
export function parsePeriod(value: string | null | undefined): string | undefined {
  if (value === PERIOD_ALL) return PERIOD_ALL;
  return parseMonth(value);
}

export function isAllHistory(period: string | null | undefined): boolean {
  return period === PERIOD_ALL;
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

export function formatPeriod(period: string): string {
  return isAllHistory(period) ? ALL_HISTORY_LABEL : formatMonth(period);
}

export function readStoredPeriod(): string | undefined {
  try {
    return parsePeriod(sessionStorage.getItem(PERIOD_MONTH_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function persistPeriod(period: string): void {
  if (!parsePeriod(period)) return;
  try {
    sessionStorage.setItem(PERIOD_MONTH_STORAGE_KEY, period);
  } catch {
    /* private mode or quota — the URL still carries the period for this view */
  }
}

/** Last concrete month, kept while the period sits on all-history. */
export function readLastMonth(): string | undefined {
  try {
    return parseMonth(sessionStorage.getItem(PERIOD_LAST_MONTH_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function persistLastMonth(month: string): void {
  if (!isMonth(month)) return;
  try {
    sessionStorage.setItem(PERIOD_LAST_MONTH_STORAGE_KEY, month);
  } catch {
    /* private mode or quota — the anchor is a convenience, not the source of truth */
  }
}

/* Kept for callers that only know about months (tests, older imports). */
export function readStoredMonth(): string | undefined {
  return parseMonth(readStoredPeriod());
}

export function persistMonth(month: string): void {
  persistPeriod(month);
}
