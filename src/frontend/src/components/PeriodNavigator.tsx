import { formatMonth, shiftMonth } from "../utils/period";

/**
 * Compact month navigation shared by Dashboard, Budget and Expenses.
 *
 * It only owns the label and the arrows; the caller decides how the month is
 * stored (the shared `usePeriod` hook writes `?month=YYYY-MM`).
 */
export default function PeriodNavigator({
  month,
  onChange,
  className = "",
}: {
  month: string;
  onChange: (month: string) => void;
  className?: string;
}) {
  return (
    <nav
      aria-label="Período"
      className={`inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--color-surface)] px-1 py-0.5 ${className}`}
    >
      <button
        type="button"
        onClick={() => onChange(shiftMonth(month, -1))}
        aria-label="Mes anterior"
        title="Mes anterior"
        className="h-7 w-7 rounded-full text-base leading-none text-[var(--text-secondary)] transition-colors hover:bg-[var(--color-base-alt)] hover:text-[var(--color-primary)]"
      >
        ‹
      </button>
      <span
        aria-live="polite"
        className="min-w-[8.5rem] text-center text-sm font-medium text-[var(--text-primary)]"
      >
        {formatMonth(month)}
      </span>
      <button
        type="button"
        onClick={() => onChange(shiftMonth(month, 1))}
        aria-label="Mes siguiente"
        title="Mes siguiente"
        className="h-7 w-7 rounded-full text-base leading-none text-[var(--text-secondary)] transition-colors hover:bg-[var(--color-base-alt)] hover:text-[var(--color-primary)]"
      >
        ›
      </button>
    </nav>
  );
}
