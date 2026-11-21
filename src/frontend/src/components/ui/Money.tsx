import { formatMoney, formatMoneyTotals } from "../../utils/money";
import type { MoneyAmount } from "../../utils/money";

const SIZE_CLASS = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
} as const;

export interface MoneyProps {
  amount: number;
  currency?: string | null;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}

/**
 * Single amount rendered with the app-wide money notation.
 *
 * Formatting is delegated to `formatMoney`, so ARS/USD distinguish their
 * prefixes and the number body always uses Argentine separators.
 */
export default function Money({ amount, currency, size = "md", className = "" }: MoneyProps) {
  return (
    <span className={`tabular-nums ${SIZE_CLASS[size]} ${className}`.trim()}>
      {formatMoney(amount, currency)}
    </span>
  );
}

export interface MoneyTotalsProps {
  items: MoneyAmount[];
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}

/**
 * Several amounts in one line, never adding different currencies together.
 * Example: "$ 30.000,00 + U$S 7,00".
 */
export function MoneyTotals({ items, size = "md", className = "" }: MoneyTotalsProps) {
  return (
    <span className={`tabular-nums ${SIZE_CLASS[size]} ${className}`.trim()}>
      {formatMoneyTotals(items)}
    </span>
  );
}
