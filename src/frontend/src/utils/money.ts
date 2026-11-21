const numberFormatter = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface MoneyAmount {
  amount: number;
  currency?: string | null;
}

function normalizeCurrency(currency?: string | null): string {
  return (currency || "ARS").toUpperCase();
}

function prefixFor(currency: string): string {
  return currency === "USD" ? "U$S" : "$";
}

/**
 * Single money notation for the whole app.
 *
 * Pesos keep the local "$" and dollars use "U$S", so a table that mixes both
 * can never be read as if every amount were in the same currency. The number
 * body always uses Argentine separators: thousands with "." and decimals ",".
 */
export function formatMoney(amount: number, currency?: string | null): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${prefixFor(normalizeCurrency(currency))} ${numberFormatter.format(
    Math.abs(amount),
  )}`;
}

/**
 * Formats a list of amounts without ever adding different currencies together.
 * Example: "$ 30.000,00 + U$S 7,00".
 */
export function formatMoneyTotals(items: MoneyAmount[]): string {
  if (items.length === 0) return formatMoney(0, "ARS");

  const totals = new Map<string, number>();
  for (const { amount, currency } of items) {
    const key = normalizeCurrency(currency);
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }

  const currencies = [...totals.keys()].sort((a, b) => {
    if (a === b) return 0;
    if (a === "ARS") return -1;
    if (b === "ARS") return 1;
    return a.localeCompare(b);
  });

  return currencies.map((currency) => formatMoney(totals.get(currency) ?? 0, currency)).join(" + ");
}
