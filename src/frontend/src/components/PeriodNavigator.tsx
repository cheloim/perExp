import {
  ALL_HISTORY_LABEL,
  PERIOD_ALL,
  currentMonth,
  formatPeriod,
  isAllHistory,
  shiftMonth,
} from "../utils/period";

/**
 * Compact period navigation shared by Dashboard, Budget and Expenses.
 *
 * It only owns the label and the controls; the caller decides how the period
 * is stored (the shared `usePeriod` hook writes `?month=YYYY-MM` or
 * `?period=all`). On all-history the label says so and the arrows leave it for
 * the last concrete month, so the user can land somewhere familiar.
 */
export default function PeriodNavigator({
  period,
  onChange,
  anchorMonth,
  className = "",
}: {
  period: string;
  onChange: (period: string) => void;
  /** Last concrete month used when stepping out of all-history. */
  anchorMonth?: string;
  className?: string;
}) {
  const allHistory = isAllHistory(period);
  const fromMonth = allHistory ? (anchorMonth ?? currentMonth()) : period;

  return (
    <nav
      aria-label="Período"
      className={`inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--color-surface)] px-1 py-0.5 ${className}`}
    >
      <button
        type="button"
        onClick={() => onChange(shiftMonth(fromMonth, -1))}
        aria-label="Mes anterior"
        title="Mes anterior"
        className="h-7 w-7 rounded-full text-base leading-none text-[var(--text-secondary)] transition-colors hover:bg-[var(--color-base-alt)] hover:text-[var(--color-primary)]"
      >
        ‹
      </button>
      <span
        aria-live="polite"
        className="min-w-[8.5rem] whitespace-nowrap text-center text-sm font-medium text-[var(--text-primary)]"
      >
        {formatPeriod(period)}
      </span>
      <button
        type="button"
        onClick={() => onChange(shiftMonth(fromMonth, 1))}
        aria-label="Mes siguiente"
        title="Mes siguiente"
        className="h-7 w-7 rounded-full text-base leading-none text-[var(--text-secondary)] transition-colors hover:bg-[var(--color-base-alt)] hover:text-[var(--color-primary)]"
      >
        ›
      </button>
      <button
        type="button"
        onClick={() => onChange(allHistory ? fromMonth : PERIOD_ALL)}
        aria-label={ALL_HISTORY_LABEL}
        aria-pressed={allHistory}
        title={allHistory ? "Volver al último mes" : "Ver todo el historial"}
        className={`ml-0.5 rounded-full px-2 py-1 text-xs font-medium transition-colors ${
          allHistory
            ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] hover:text-[var(--color-primary)]"
        }`}
      >
        Todo
      </button>
    </nav>
  );
}
