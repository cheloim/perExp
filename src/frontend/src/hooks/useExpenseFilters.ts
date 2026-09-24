import { useSearchParams } from "react-router-dom";

export interface ExpenseFilters {
  categoryId: number | undefined;
  uncategorized: boolean;
  person: string | undefined;
  dateFrom: string | undefined;
  dateTo: string | undefined;
  tagId: number | undefined;
  untagged: boolean;
  cuentaId: number | undefined;
  sinCuenta: boolean;
}

export function useExpenseFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: ExpenseFilters = {
    categoryId: searchParams.get("category_id")
      ? parseInt(searchParams.get("category_id")!)
      : undefined,
    uncategorized: searchParams.get("uncategorized") === "1",
    person: searchParams.get("person") || undefined,
    dateFrom: searchParams.get("date_from") || undefined,
    dateTo: searchParams.get("date_to") || undefined,
    tagId: searchParams.get("tag_id") ? parseInt(searchParams.get("tag_id")!) : undefined,
    untagged: searchParams.get("untagged") === "1",
    cuentaId: searchParams.get("cuenta_id") ? parseInt(searchParams.get("cuenta_id")!) : undefined,
    sinCuenta: searchParams.get("sin_cuenta") === "1",
  };

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const clearFilters = () => setSearchParams(new URLSearchParams());

  return { filters, setFilter, clearFilters, searchParams, setSearchParams };
}
