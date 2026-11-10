/**
 * Footer copy for the expenses table.
 *
 * `total` comes from the stats endpoint, so the number is the filtered total,
 * not just the rows already fetched. When the total is unknown the label
 * degrades to the plain loaded count.
 */
export function paginationLabel(shown: number, total?: number): string {
  const noun = shown === 1 ? "gasto" : "gastos";
  if (total !== undefined && total > shown) return `Mostrando ${shown} de ${total} gastos`;
  return `${shown} ${noun}`;
}

export function hasMorePages(shown: number, total: number | undefined, limit: number): boolean {
  return total !== undefined ? total > shown : shown >= limit;
}
