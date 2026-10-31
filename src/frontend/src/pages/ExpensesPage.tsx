import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from "react";
import { Link } from "react-router-dom";
import { showToast } from "../utils/toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUndoToast } from "../hooks/useUndoToast";
import {
  getExpenses,
  getCategories,
  getTags,
  bulkUpdateTags,
  getExpenseStats,
  createExpense,
  updateExpense,
  deleteExpense,
  bulkDeleteExpenses,
  bulkUpdateFields,
  getSuggestions,
  approveSuggestion,
  rejectSuggestion,
  approveAllSuggestions,
  discardAllSuggestions,
} from "../api/client";
import type { Expense, ExpenseCreate } from "../types";
import { ExpenseModal } from "../components/ExpenseModals";
import ExpenseDetailModal from "../components/ExpenseDetailModal";
import EmptyState from "../components/ui/EmptyState";
import SymbolicIcon from "../components/SymbolicIcon";
import QuickEditPopover from "../components/QuickEditPopover";
import BulkActionBar from "../components/BulkActionBar";
import BulkTagPicker from "../components/BulkTagPicker";
import { getCategoryIcon } from "../utils/categoryIcon";
import {
  formatCurrency,
  titleCase,
  SortIcon,
  categoryGroupOptions,
  formatDateDMY,
} from "../utils/format";
import { useExpenseFilters } from "../hooks/useExpenseFilters";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { expenseQueryKeys, invalidateExpenseQueries } from "../utils/expenseQueries";
import { buildFilterChips, type FilterChip } from "../utils/expenseFilterChips";
import { hasMorePages, paginationLabel } from "../utils/pagination";
import { ExpensesFilterBar } from "../components/expenses/ExpensesFilterBar";

type SortField = "date" | "description" | "category" | "bank" | "person" | "amount";
type SortDir = "asc" | "desc";

function hasMissingData(exp: Expense): boolean {
  return !exp.category_id;
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      title={label}
      className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
    />
  );
}

function selectionSummary(selected: Expense[]): string {
  const totals = new Map<string, number>();
  for (const expense of selected) {
    const currency = expense.currency || "ARS";
    totals.set(currency, (totals.get(currency) ?? 0) + expense.amount);
  }
  return [...totals.entries()]
    .map(([currency, total]) => formatCurrency(total, currency))
    .join(" + ");
}

function SortableHeader({
  field,
  label,
  className,
  sort,
  onSort,
}: {
  field: SortField;
  label: string;
  className: string;
  sort: { field: SortField; dir: SortDir };
  onSort: (field: SortField) => void;
}) {
  const active = sort.field === field;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={className}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex w-full items-center gap-1 text-left"
      >
        {label} <SortIcon field={field} sort={sort} />
      </button>
    </th>
  );
}

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const {
    filters,
    setFilter,
    setCategoryIds,
    setDateRange,
    clearDateRange,
    setCuenta,
    setEtiqueta,
    clearFilters,
    ready,
    searchParams,
    setSearchParams,
    searchInput,
    setSearchInput,
  } = useExpenseFilters();

  const filterCategoryIds = filters.categoryIds;
  const filterUncategorized = filters.uncategorized;
  const filterPerson = filters.person;
  const filterDateFrom = filters.dateFrom;
  const filterDateTo = filters.dateTo;
  const filterTagId = filters.tagId;
  const filterUntagged = filters.untagged;
  const filterCuentaId = filters.cuentaId;
  const filterSinCuenta = filters.sinCuenta;
  const filterSearch = filters.q;

  // Category suggestions from API
  const {
    data: suggestionsData = [],
    refetch: refetchSuggestions,
    isFetched: suggestionsFetched,
  } = useQuery({
    queryKey: ["suggestions"],
    queryFn: () => getSuggestions("pending"),
    staleTime: 30_000,
  });
  const showSuggestions = suggestionsData.length > 0;
  const suggestionsByExpenseId = useMemo(
    () => new Map(suggestionsData.map((s) => [s.expense_id, s])),
    [suggestionsData],
  );

  const suggestionsBannerRef = useRef<HTMLDivElement>(null);

  // "Ver sugerencias" from a notification lands here. Take the user to the
  // banner instead of dropping them at the top of an unfiltered table (#455).
  const wantsSuggestions = searchParams.get("category_suggestions") === "1";
  useEffect(() => {
    if (!wantsSuggestions || !suggestionsFetched) return;
    if (showSuggestions) {
      suggestionsBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      // The notification outlived its suggestions: say so instead of nothing.
      showToast("No hay sugerencias pendientes", "info", 5000, "bottom-center");
    }
    const next = new URLSearchParams(searchParams);
    next.delete("category_suggestions");
    setSearchParams(next, { replace: true });
  }, [wantsSuggestions, suggestionsFetched, showSuggestions, searchParams, setSearchParams]);

  // The same filters feed the table, the stats cards and the breakdowns, so
  // the numbers above always match the rows below (issue #477).
  const filterParams = {
    category_ids: filterCategoryIds.length ? filterCategoryIds.join(",") : undefined,
    uncategorized: filterUncategorized || undefined,
    person: filterPerson,
    date_from: filterDateFrom,
    date_to: filterDateTo,
    tag_id: filterTagId,
    untagged: filterUntagged || undefined,
    cuenta_id: filterCuentaId,
    sin_cuenta: filterSinCuenta || undefined,
    search: filterSearch,
  };

  const handleCategorySelection = useCallback(
    (values: string[]) => {
      // "Sin categoría" is exclusive: it is not an id, and it cannot coexist
      // with a category selection.
      if (values.includes("__none__")) {
        const next = new URLSearchParams(searchParams);
        next.delete("category_id");
        next.delete("category_ids");
        next.set("uncategorized", "1");
        setSearchParams(next);
        return;
      }
      setCategoryIds(values.map(Number).filter((id) => Number.isInteger(id) && id > 0));
    },
    [searchParams, setSearchParams, setCategoryIds],
  );

  const [visibleCount, setVisibleCount] = useState(100);

  const filterKey = `${filterCategoryIds.join(",")}-${filterUncategorized}-${filterPerson}-${filterDateFrom}-${filterDateTo}-${filterTagId}-${filterUntagged}-${filterCuentaId}-${filterSinCuenta}-${filterSearch}`;

  // A new filter set starts from the first page again. An effect (instead of a
  // state update during render) keeps the render path pure; the list keeps the
  // previous page as placeholder data while the reset settles.
  useEffect(() => {
    setVisibleCount(100);
  }, [filterKey]);

  const invalidate = () => invalidateExpenseQueries(queryClient);

  const {
    data: expenses = [],
    isLoading,
    isFetching,
  } = useQuery<Expense[]>({
    queryKey: expenseQueryKeys.list(filterKey, visibleCount),
    queryFn: () => getExpenses({ ...filterParams, limit: visibleCount }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    enabled: ready,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: getCategories,
  });

  const { data: tags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: getTags,
    staleTime: 300_000,
  });

  const { data: expenseStats, isFetching: statsFetching } = useQuery({
    queryKey: expenseQueryKeys.stats(filterKey),
    queryFn: () => getExpenseStats(filterParams),
    placeholderData: (prev) => prev,
    enabled: ready,
  });

  const [editing, setEditing] = useState<Expense | null | undefined>(undefined);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({
    field: "date",
    dir: "desc",
  });
  const handleSort = (field: SortField) => {
    setSort((current) => ({
      field,
      dir: current.field === field && current.dir === "asc" ? "desc" : "asc",
    }));
  };
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkPicker, setBulkPicker] = useState<{
    type: "category" | "cuenta" | "tags";
    rect: DOMRect;
  } | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const lastSelectedRef = useRef<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: number;
    description: string;
  } | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [quickEdit, setQuickEdit] = useState<{
    expenseId: number;
    type: "category" | "cuenta";
    rect: DOMRect;
  } | null>(null);

  const createMut = useMutation({
    mutationFn: createExpense,
    onSuccess: () => {
      invalidate();
      setEditing(undefined);
      setSaveError(null);
    },
    onError: (e: Error) => setSaveError(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ExpenseCreate> }) =>
      updateExpense(id, data),
    onSuccess: () => {
      invalidate();
      setEditing(undefined);
      setSaveError(null);
    },
    onError: (e: Error) => setSaveError(e.message),
  });

  const quickUpdateMut = useMutation({
    mutationFn: async ({
      id,
      field,
      value,
    }: {
      id: number;
      field: "category_id" | "cuenta";
      value: number | null;
    }) => {
      if (field === "category_id") {
        return updateExpense(id, { category_id: value });
      }
      // "cuenta" = tag swap. Build new tag_ids preserving non-cuenta tags.
      const exp = expenses.find((e) => e.id === id);
      const keepTagIds = (exp?.tags ?? [])
        .filter((t) => t.group_name !== "cuenta")
        .map((t) => t.id);
      const newTagIds = value != null ? [...keepTagIds, value] : keepTagIds;
      return updateExpense(id, { tag_ids: newTagIds });
    },
    onMutate: async ({ id, field, value }) => {
      await queryClient.cancelQueries({ queryKey: ["expenses-list"] });
      const queryKey = expenseQueryKeys.list(filterKey, visibleCount);
      const previous = queryClient.getQueryData<Expense[]>(queryKey);
      queryClient.setQueryData<Expense[]>(queryKey, (old) => {
        if (!old) return old;
        // Under a category filter, a row that no longer matches has to leave
        // the table now; the invalidated aggregates catch up with the server.
        if (field === "category_id") {
          const stillMatches =
            (filterCategoryIds.length === 0 ||
              (value != null && filterCategoryIds.includes(value))) &&
            !(filterUncategorized && value != null);
          if (!stillMatches) return old.filter((e) => e.id !== id);
        }
        return old.map((e) => {
          if (e.id !== id) return e;
          if (field === "category_id") {
            const cat = categories.find((c) => c.id === value);
            return {
              ...e,
              category_id: value,
              category_name: cat?.name ?? null,
              category_color: cat?.color ?? null,
            };
          }
          // cuenta tag swap
          const keepTags = (e.tags ?? []).filter((t) => t.group_name !== "cuenta");
          const newTag = value != null ? tags.find((t) => t.id === value) : undefined;
          return {
            ...e,
            tags: newTag ? [...keepTags, newTag] : keepTags,
          };
        });
      });
      return { previous, queryKey };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(ctx.queryKey, ctx.previous);
      }
      setSaveError("Error al actualizar");
    },
    onSettled: () => {
      invalidate();
      setQuickEdit(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: deleteExpense,
    onSuccess: () => {
      invalidate();
    },
    onError: (_err, id) => {
      // Restore on API failure
      const saved = pendingDeletes.current.get(id);
      if (saved?.expense) {
        queryClient.setQueryData<Expense[]>(
          expenseQueryKeys.list(filterKey, visibleCount),
          (old) =>
            old
              ? [...old, saved.expense].sort(
                  (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
                )
              : [saved.expense],
        );
      }
      pendingDeletes.current.delete(id);
    },
  });

  const { show: showUndo } = useUndoToast();
  const pendingDeletes = useRef<
    Map<number, { timer: ReturnType<typeof setTimeout>; expense: Expense }>
  >(new Map());

  const handleDelete = (id: number, description: string) => {
    // Optimistic: remove from list immediately
    const queryKey = [
      "expenses-list",
      filterCategoryIds.join(","),
      filterUncategorized,
      filterPerson,
      filterDateFrom,
      filterDateTo,
      filterTagId,
    ];
    const current = queryClient.getQueryData<Expense[]>(queryKey) ?? [];
    const removed = current.find((e) => e.id === id);

    queryClient.setQueryData<Expense[]>(
      queryKey,
      current.filter((e) => e.id !== id),
    );

    const timer = setTimeout(() => {
      deleteMut.mutate(id);
      pendingDeletes.current.delete(id);
    }, 3000);
    pendingDeletes.current.set(id, { timer, expense: removed! });

    showUndo(
      `"${description}" eliminado`,
      () => {},
      () => {
        // Undo: restore expense and cancel API call
        const entry = pendingDeletes.current.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          pendingDeletes.current.delete(id);
          const existing = queryClient.getQueryData<Expense[]>(queryKey) ?? [];
          queryClient.setQueryData<Expense[]>(
            queryKey,
            [...existing, entry.expense].sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            ),
          );
        }
      },
    );
  };

  const handleSave = (data: ExpenseCreate) => {
    setSaveError(null);
    if (editing && editing.id) {
      updateMut.mutate({ id: editing.id, data });
    } else {
      createMut.mutate(data);
    }
  };

  const thClass = (field: SortField) =>
    `px-4 py-3 text-left cursor-pointer select-none hover:bg-[var(--color-base-alt)] whitespace-nowrap text-xs font-medium text-[var(--text-secondary)] uppercase ${
      sort.field === field ? "text-[var(--color-primary)]" : ""
    }`;

  const sortedExpenses = useMemo(() => {
    return [...expenses].sort((a, b) => {
      const field = sort.field === "category" ? "category_name" : sort.field;
      const aVal = a[field as keyof Expense];
      const bVal = b[field as keyof Expense];
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (sort.field === "amount") {
        return sort.dir === "asc"
          ? (aVal as number) - (bVal as number)
          : (bVal as number) - (aVal as number);
      }
      if (sort.field === "date") {
        const parseDate = (s: string) => {
          const [d, m, y] = s.split("-").map(Number);
          return new Date(y, m - 1, d).getTime();
        };
        const aTime = parseDate(String(aVal));
        const bTime = parseDate(String(bVal));
        return sort.dir === "asc" ? aTime - bTime : bTime - aTime;
      }
      let aStr = String(aVal);
      let bStr = String(bVal);
      if (sort.field === "description") {
        const pad = (n: number | null | undefined) => String(n ?? 0).padStart(4, "0");
        aStr += `\x00${pad(a.installment_number)}`;
        bStr += `\x00${pad(b.installment_number)}`;
      }
      const cmp = aStr.localeCompare(bStr);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [expenses, sort.field, sort.dir]);

  const selectedExpenses = useMemo(
    () => sortedExpenses.filter((expense) => selectedIds.has(expense.id)),
    [sortedExpenses, selectedIds],
  );

  const selectedCount = selectedExpenses.length;
  const selectedSummary = useMemo(() => selectionSummary(selectedExpenses), [selectedExpenses]);
  const allVisibleSelected =
    sortedExpenses.length > 0 && sortedExpenses.every((expense) => selectedIds.has(expense.id));
  const someVisibleSelected = !allVisibleSelected && selectedCount > 0;

  // A selection only makes sense against the rows the user is looking at.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterKey]);

  // Escape clears the selection, except while a text field has focus.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      const typingField =
        target instanceof HTMLInputElement &&
        !["checkbox", "radio", "button", "submit"].includes(target.type);
      if (typingField || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") {
        return;
      }
      if (target?.isContentEditable) return;
      setSelectedIds(new Set());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds.size]);

  const toggleRowSelection = (id: number, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const anchor = lastSelectedRef.current;
      if (shiftKey && anchor != null && anchor !== id) {
        const order = sortedExpenses.map((expense) => expense.id);
        const from = order.indexOf(anchor);
        const to = order.indexOf(id);
        if (from !== -1 && to !== -1) {
          const [start, end] = from < to ? [from, to] : [to, from];
          for (let i = start; i <= end; i += 1) next.add(order[i]);
          lastSelectedRef.current = id;
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      lastSelectedRef.current = id;
      return next;
    });
  };

  const plural = (count: number) => (count === 1 ? "gasto" : "gastos");

  const runBulk = async (
    ids: number[],
    action: () => Promise<{ updated?: number; deleted?: number }>,
    message: (count: number) => string,
  ) => {
    if (ids.length === 0 || bulkPending) return;
    setBulkPending(true);
    try {
      const result = await action();
      invalidate();
      setSelectedIds(new Set());
      const count = result.updated ?? result.deleted ?? ids.length;
      showToast(message(count), "success", 4500, "bottom-center");
    } catch (error) {
      // A partially applied action still changed data; refresh before telling.
      invalidate();
      showToast(
        error instanceof Error ? error.message : "No se pudo completar la acción",
        "error",
        6000,
        "top-right",
      );
    } finally {
      setBulkPending(false);
    }
  };

  const applyBulkCategory = (value: string) => {
    const ids = selectedExpenses.map((expense) => expense.id);
    setBulkPicker(null);
    const categoryId = value === "__clear__" ? null : parseInt(value);
    void runBulk(
      ids,
      () => bulkUpdateFields(ids, { category_id: categoryId }),
      (count) => `Categoría actualizada en ${count} ${plural(count)}`,
    );
  };

  const applyBulkCuenta = (value: string) => {
    const ids = selectedExpenses.map((expense) => expense.id);
    setBulkPicker(null);
    if (value === "__clear__") {
      const cuentaIds = [
        ...new Set(
          selectedExpenses.flatMap((expense) =>
            (expense.tags ?? []).filter((tag) => tag.group_name === "cuenta").map((tag) => tag.id),
          ),
        ),
      ];
      if (cuentaIds.length === 0) {
        setSelectedIds(new Set());
        return;
      }
      void runBulk(
        ids,
        () => bulkUpdateTags({ ids, tag_ids: cuentaIds, mode: "remove" }),
        (count) => `Cuenta quitada en ${count} ${plural(count)}`,
      );
      return;
    }
    const tagId = parseInt(value);
    void runBulk(
      ids,
      () => bulkUpdateTags({ ids, tag_ids: [tagId], mode: "add" }),
      (count) => `Cuenta actualizada en ${count} ${plural(count)}`,
    );
  };

  const applyBulkTags = (addIds: number[], removeIds: number[]) => {
    const ids = selectedExpenses.map((expense) => expense.id);
    setBulkPicker(null);
    void runBulk(
      ids,
      async () => {
        let updated = 0;
        if (addIds.length > 0) {
          const result = await bulkUpdateTags({ ids, tag_ids: addIds, mode: "add" });
          updated = result.updated;
        }
        if (removeIds.length > 0) {
          const result = await bulkUpdateTags({ ids, tag_ids: removeIds, mode: "remove" });
          updated = result.updated;
        }
        return { updated };
      },
      (count) => `Etiquetas actualizadas en ${count} ${plural(count)}`,
    );
  };

  const deleteSelected = () => {
    const ids = selectedExpenses.map((expense) => expense.id);
    setBulkDeleteConfirm(false);
    void runBulk(
      ids,
      () => bulkDeleteExpenses(ids),
      (count) => `${count} ${plural(count)} eliminado${count === 1 ? "" : "s"}`,
    );
  };

  const buildCsv = (rows: Expense[]) => {
    const headers = ["Fecha", "Descripción", "Monto", "Moneda", "Categoría", "Cuenta", "Etiquetas"];
    const lines = rows.map((expense) => [
      expense.date,
      `"${expense.description.replace(/"/g, '""')}"`,
      expense.amount,
      expense.currency || "ARS",
      expense.category_name || "",
      expense.tags?.find((tag) => tag.group_name === "cuenta")?.name || "",
      expense.tags
        ?.filter((tag) => tag.group_name !== "categoria" && tag.group_name !== "cuenta")
        .map((tag) => tag.name)
        .join("; ") || "",
    ]);
    return [headers.join(","), ...lines.map((line) => line.join(","))].join("\n");
  };

  const downloadCsv = (rows: Expense[], filename: string) => {
    const blob = new Blob(["\uFEFF" + buildCsv(rows)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = async () => {
    const allData = await getExpenses({
      ...filterParams,
      limit: 10000,
    });
    downloadCsv(allData, `gastos_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const exportSelected = () => {
    if (selectedExpenses.length === 0) return;
    downloadCsv(
      selectedExpenses,
      `gastos_seleccionados_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const cuentaTags = tags.filter((tag) => tag.group_name === "cuenta");
  const otrosTags = tags.filter((tag) => tag.group_name === "otros");

  const chips = useMemo(
    () => buildFilterChips(filters, categories, tags),
    [filters, categories, tags],
  );
  const activeFiltersCount = chips.length;

  const clearChip = useCallback(
    (chip: FilterChip) => {
      switch (chip.kind) {
        case "search":
          setSearchInput("");
          setFilter("q", undefined);
          break;
        case "category":
          setCategoryIds(filterCategoryIds.filter((id) => id !== chip.value));
          break;
        case "uncategorized":
          handleCategorySelection([]);
          break;
        case "cuenta":
        case "sin_cuenta":
          setCuenta("");
          break;
        case "tag":
        case "untagged":
          setEtiqueta("");
          break;
        case "date":
          clearDateRange();
          break;
        case "person":
          setFilter("person", undefined);
          break;
      }
    },
    [
      filterCategoryIds,
      setCategoryIds,
      handleCategorySelection,
      setCuenta,
      setEtiqueta,
      clearDateRange,
      setFilter,
      setSearchInput,
    ],
  );

  const resultSummary = filterSearch
    ? `${expenses.length}${expenses.length >= visibleCount ? "+" : ""} gastos para «${filterSearch}»`
    : activeFiltersCount > 0 && !isLoading
      ? `${expenses.length}${expenses.length >= visibleCount ? "+" : ""} gastos con los filtros aplicados`
      : "";

  return (
    <div className={`space-y-6 ${selectedCount > 0 ? "pb-52 md:pb-28" : "pb-20 md:pb-0"}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Gastos</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="gnome-btn-secondary-round text-sm"
            title="Exportar gastos a CSV"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="inline mr-1">
              <path
                d="M3 10v3h10v-3M8 2v8M5 7l3 3 3-3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            CSV
          </button>
          <button onClick={() => setEditing(null)} className="gnome-btn-primary-round text-sm">
            <span className="text-base leading-none">+</span>
            <span>Nuevo gasto</span>
          </button>
        </div>
      </div>

      {/* Category suggestions banner */}
      {showSuggestions && (
        <div
          ref={suggestionsBannerRef}
          className="card border-l-4 border-l-purple-500 bg-purple-500/5"
        >
          <div className="px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                ✨ IA sugirió categorías para {suggestionsData.length} gasto
                {suggestionsData.length !== 1 ? "s" : ""}
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                Revisá las sugerencias inline y aplicá las que correspondan
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  await approveAllSuggestions(0.7);
                  invalidate();
                  refetchSuggestions();
                }}
                className="gnome-btn-secondary-round text-xs"
              >
                Aplicar todas (≥70%)
              </button>
              <button
                onClick={async () => {
                  await discardAllSuggestions();
                  refetchSuggestions();
                }}
                className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                Descartar todas
              </button>
            </div>
          </div>
        </div>
      )}

      <ExpensesFilterBar
        filters={filters}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        expanded={filtersExpanded}
        onToggleExpanded={() => setFiltersExpanded((current) => !current)}
        categories={categories}
        tags={tags}
        chips={chips}
        resultSummary={resultSummary}
        onCategoryChange={handleCategorySelection}
        onCuentaChange={setCuenta}
        onTagChange={setEtiqueta}
        onDateRangeChange={setDateRange}
        onClearChip={clearChip}
        onClearAll={clearFilters}
      />

      {/* Stats cards + Charts */}
      {ready &&
        (() => {
          const arsExpenses = expenses.filter((e) => (e.currency || "ARS") === "ARS");
          const arsTotal = expenseStats?.total ?? arsExpenses.reduce((s, e) => s + e.amount, 0);
          const totalCount = expenseStats?.count ?? expenses.length;
          const avg =
            expenseStats?.avg ?? (arsExpenses.length > 0 ? arsTotal / arsExpenses.length : 0);
          const max = arsExpenses.length > 0 ? Math.max(...arsExpenses.map((e) => e.amount)) : 0;
          // The category analysis lives on its own page. Carry the month when
          // the active range maps to exactly one calendar month.
          const monthForLink =
            filters.month ??
            (filterDateFrom &&
            filterDateTo &&
            filterDateFrom.slice(0, 7) === filterDateTo.slice(0, 7)
              ? filterDateFrom.slice(0, 7)
              : undefined);
          return (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-secondary">Resumen</h2>
                <Link
                  to={monthForLink ? `/cat-dashboard?month=${monthForLink}` : "/cat-dashboard"}
                  className="text-xs text-[var(--color-primary)] hover:underline"
                >
                  Ver análisis por categoría →
                </Link>
              </div>
              {/* Stats cards */}
              <div
                aria-busy={statsFetching}
                className={`grid grid-cols-2 sm:grid-cols-4 gap-3 transition-opacity ${
                  statsFetching ? "opacity-70" : ""
                }`}
              >
                <div className="card p-3">
                  <p className="text-[10px] text-tertiary uppercase">Total</p>
                  <p className="text-lg font-bold text-primary">
                    {expenseStats === undefined ? (
                      <span className="inline-block h-5 w-20 animate-pulse rounded bg-[var(--color-base-alt)]" />
                    ) : (
                      formatCurrency(arsTotal)
                    )}
                  </p>
                </div>
                <div className="card p-3">
                  <p className="text-[10px] text-tertiary uppercase">Gastos</p>
                  <p className="text-lg font-bold text-primary">
                    {expenseStats === undefined ? (
                      <span className="inline-block h-5 w-10 animate-pulse rounded bg-[var(--color-base-alt)]" />
                    ) : (
                      totalCount
                    )}
                  </p>
                </div>
                <div className="card p-3">
                  <p className="text-[10px] text-tertiary uppercase">Promedio</p>
                  <p className="text-lg font-bold text-primary">
                    {expenseStats === undefined ? (
                      <span className="inline-block h-5 w-20 animate-pulse rounded bg-[var(--color-base-alt)]" />
                    ) : (
                      formatCurrency(avg)
                    )}
                  </p>
                </div>
                <div className="card p-3">
                  <p className="text-[10px] text-tertiary uppercase">Mayor gasto</p>
                  <p className="text-lg font-bold text-primary">
                    {expenseStats === undefined ? (
                      <span className="inline-block h-5 w-20 animate-pulse rounded bg-[var(--color-base-alt)]" />
                    ) : (
                      formatCurrency(max)
                    )}
                  </p>
                </div>
              </div>
            </>
          );
        })()}

      <div
        aria-busy={isFetching && !isLoading}
        className={`card overflow-hidden transition-opacity ${
          isFetching && !isLoading ? "opacity-60" : ""
        }`}
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--color-surface)] border-b border-[var(--border-color)]">
              <tr>
                <th className="w-10 px-3 py-3">
                  <SelectAllCheckbox
                    checked={allVisibleSelected}
                    indeterminate={someVisibleSelected}
                    onChange={(checked) =>
                      setSelectedIds(
                        checked ? new Set(expenses.map((expense) => expense.id)) : new Set(),
                      )
                    }
                    label={
                      allVisibleSelected
                        ? "Deseleccionar los gastos visibles"
                        : "Seleccionar los gastos visibles"
                    }
                  />
                </th>
                <SortableHeader
                  field="date"
                  label="Fecha"
                  className={thClass("date") + " hidden sm:table-cell"}
                  sort={sort}
                  onSort={handleSort}
                />
                <SortableHeader
                  field="description"
                  label="Descripción"
                  className={thClass("description")}
                  sort={sort}
                  onSort={handleSort}
                />
                <SortableHeader
                  field="category"
                  label="Categoría"
                  className={thClass("category") + " hidden sm:table-cell"}
                  sort={sort}
                  onSort={handleSort}
                />
                <th className="px-3 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase hidden md:table-cell">
                  Cuenta
                </th>
                <SortableHeader
                  field="amount"
                  label="Monto"
                  className={thClass("amount")}
                  sort={sort}
                  onSort={handleSort}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-color)]">
              {isLoading ? (
                <>
                  {[...Array(8)].map((_, i) => (
                    <tr key={i} className="border-b border-[var(--border-color)]">
                      <td className="px-3 py-3">
                        <div className="h-4 w-4 rounded bg-[var(--color-base-alt)] animate-pulse" />
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse w-16" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse w-40" />
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse w-20" />
                      </td>
                      <td className="px-3 py-3 hidden md:table-cell">
                        <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse w-16" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse w-16" />
                      </td>
                    </tr>
                  ))}
                </>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-4">
                    <EmptyState
                      icon="list"
                      title={
                        activeFiltersCount > 0 ? "Sin resultados" : "No hay gastos registrados"
                      }
                      description={
                        activeFiltersCount > 0
                          ? "No hay gastos que coincidan con estos filtros"
                          : "Creá un gasto para empezar a trackear tus gastos"
                      }
                      action={
                        activeFiltersCount > 0
                          ? { label: "Limpiar filtros", onClick: clearFilters }
                          : {
                              label: "Crear gasto",
                              onClick: () => setEditing(null),
                            }
                      }
                    />
                  </td>
                </tr>
              ) : (
                (() => {
                  const isDateSort = sort.field === "date";
                  let lastDate = "";
                  return sortedExpenses.map((exp) => {
                    const missing = hasMissingData(exp);
                    const showDateHeader = isDateSort && exp.date !== lastDate;
                    if (showDateHeader) lastDate = exp.date;
                    return (
                      <Fragment key={exp.id}>
                        {showDateHeader && (
                          <tr key={`date-${exp.date}`}>
                            <td
                              colSpan={6}
                              className="px-4 py-2 text-xs font-medium text-[var(--text-tertiary)] bg-[var(--color-base-alt)]"
                            >
                              {formatDateDMY(exp.date)}
                            </td>
                          </tr>
                        )}
                        <tr
                          key={exp.id}
                          className={`group cursor-pointer transition-colors hover:bg-[var(--color-base-alt)]/30 ${
                            selectedIds.has(exp.id)
                              ? "bg-[var(--color-primary)]/10 shadow-[inset_3px_0_0_var(--color-primary)]"
                              : ""
                          }`}
                          style={missing ? { borderLeft: "3px solid #f6d32d" } : undefined}
                          onClick={() => setDetailExpense(exp)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setQuickEdit({
                              expenseId: exp.id,
                              type: "category",
                              rect: DOMRect.fromRect({
                                x: e.clientX,
                                y: e.clientY,
                                width: 0,
                                height: 0,
                              }),
                            });
                          }}
                        >
                          <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(exp.id)}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRowSelection(exp.id, e.shiftKey);
                              }}
                              onChange={() => {}}
                              aria-label={`Seleccionar ${exp.description}`}
                              className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                            />
                          </td>
                          {isDateSort ? (
                            <td className="px-4 py-3 hidden sm:table-cell" />
                          ) : (
                            <td className="px-4 py-3 hidden sm:table-cell text-[var(--text-tertiary)] whitespace-nowrap">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDetailExpense(exp);
                                }}
                                className="text-left hover:text-primary transition"
                              >
                                {formatDateDMY(exp.date)}
                              </button>
                            </td>
                          )}
                          <td className="px-4 py-3 max-w-0 w-full">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0"
                                style={{
                                  backgroundColor: (exp.category_color || "#6b7280") + "20",
                                }}
                              >
                                {getCategoryIcon(exp.category_name) ? (
                                  <SymbolicIcon
                                    name={getCategoryIcon(exp.category_name)!}
                                    size={14}
                                  />
                                ) : (
                                  <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: exp.category_color || "#6b7280" }}
                                  />
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDetailExpense(exp);
                                }}
                                aria-label={`Abrir detalle de ${exp.description}`}
                                className="text-left hover:text-primary transition flex flex-col sm:flex-row items-start gap-1 sm:gap-2 min-w-0 flex-1"
                              >
                                {!isDateSort && (
                                  <span className="sm:hidden text-xs text-[var(--text-tertiary)] shrink-0">
                                    {exp.date.slice(8, 10)}/{exp.date.slice(5, 7)}
                                  </span>
                                )}
                                <span className="flex items-center gap-1 min-w-0 max-w-full">
                                  <span className="text-[var(--text-primary)] sm:truncate">
                                    {titleCase(exp.description)}
                                  </span>
                                  {exp.installment_number && exp.installment_total && (
                                    <span className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full border border-[var(--color-primary)] text-[var(--color-primary)] shrink-0 font-medium">
                                      <SymbolicIcon name="installments" size={10} />
                                      {exp.installment_number}/{exp.installment_total}
                                    </span>
                                  )}
                                </span>
                              </button>
                              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditing(exp);
                                  }}
                                  className="p-1 rounded text-[var(--text-tertiary)] hover:text-primary hover:bg-[var(--color-base-alt)] transition"
                                  title="Editar"
                                  aria-label={`Editar ${exp.description}`}
                                >
                                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                                    <path
                                      d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z"
                                      stroke="currentColor"
                                      strokeWidth="1.2"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteConfirm({
                                      id: exp.id,
                                      description: exp.description,
                                    });
                                  }}
                                  className="p-1 rounded text-[var(--text-tertiary)] hover:text-danger hover:bg-[var(--color-base-alt)] transition"
                                  title="Eliminar"
                                  aria-label={`Eliminar ${exp.description}`}
                                >
                                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                                    <path
                                      d="M3 4h8M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M4.5 4v7a1 1 0 001 1h3a1 1 0 001-1V4"
                                      stroke="currentColor"
                                      strokeWidth="1.2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </div>
                            {/* Mobile: category + cuenta chip + otros tags under title */}
                            <div className="text-xs flex gap-1.5 items-center flex-wrap md:hidden">
                              {exp.category_name ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setQuickEdit({ expenseId: exp.id, type: "category", rect });
                                  }}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium hover:ring-1 hover:ring-[var(--color-primary)]/40 transition"
                                  style={{
                                    backgroundColor: (exp.category_color || "#9a9996") + "1F",
                                    color: "var(--text-primary)",
                                  }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: exp.category_color || "#9a9996" }}
                                  />
                                  {exp.category_name}
                                </button>
                              ) : null}
                              {(() => {
                                const cuentaTag = exp.tags?.find((t) => t.group_name === "cuenta");
                                return cuentaTag ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      setQuickEdit({ expenseId: exp.id, type: "cuenta", rect });
                                    }}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] hover:ring-1 hover:ring-[var(--color-primary)]/40 transition"
                                    style={{
                                      backgroundColor: cuentaTag.color + "1F",
                                      color: "var(--text-primary)",
                                    }}
                                  >
                                    <span
                                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: cuentaTag.color }}
                                    />
                                    {cuentaTag.name}
                                  </button>
                                ) : null;
                              })()}
                              {exp.tags
                                ?.filter(
                                  (tag: { group_name?: string }) =>
                                    tag.group_name !== "categoria" && tag.group_name !== "cuenta",
                                )
                                .map((tag: { id: number; name: string; color: string }) => (
                                  <span
                                    key={tag.id}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px]"
                                    style={{
                                      backgroundColor: tag.color + "1F",
                                      color: "var(--text-primary)",
                                    }}
                                  >
                                    <span
                                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: tag.color }}
                                    />
                                    {tag.name}
                                  </span>
                                ))}
                            </div>
                            {/* Desktop: otros tags only (cuenta is in its own column) */}
                            <div className="text-xs gap-1.5 items-center hidden md:flex flex-wrap">
                              {exp.tags
                                ?.filter(
                                  (tag: { group_name?: string }) =>
                                    tag.group_name !== "categoria" && tag.group_name !== "cuenta",
                                )
                                .map((tag: { id: number; name: string; color: string }) => (
                                  <span
                                    key={tag.id}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px]"
                                    style={{
                                      backgroundColor: tag.color + "1F",
                                      color: "var(--text-primary)",
                                    }}
                                  >
                                    <span
                                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: tag.color }}
                                    />
                                    {tag.name}
                                  </span>
                                ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            {exp.category_name ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setQuickEdit({ expenseId: exp.id, type: "category", rect });
                                }}
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium max-w-[110px] hover:ring-1 hover:ring-[var(--color-primary)]/40 transition"
                                style={{
                                  backgroundColor: (exp.category_color || "#9a9996") + "1F",
                                  color: "var(--text-primary)",
                                }}
                                title="Cambiar categoría"
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: exp.category_color || "#9a9996" }}
                                />
                                <span className="truncate">{exp.category_name}</span>
                              </button>
                            ) : showSuggestions && suggestionsByExpenseId.has(exp.id) ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="text-[var(--text-tertiary)]">—</span>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const s = suggestionsByExpenseId.get(exp.id)!;
                                    await approveSuggestion(s.id);
                                    invalidate();
                                    refetchSuggestions();
                                  }}
                                  className={`px-2 py-1 rounded text-xs font-medium transition ${
                                    suggestionsByExpenseId.get(exp.id)!.confidence >= 0.7
                                      ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20"
                                      : "bg-purple-500/5 text-purple-400/70 dark:text-purple-500/50 hover:bg-purple-500/10"
                                  }`}
                                  title={`Sugerencia: ${
                                    suggestionsByExpenseId.get(exp.id)!.parent_name
                                      ? suggestionsByExpenseId.get(exp.id)!.parent_name + " > "
                                      : ""
                                  }${
                                    suggestionsByExpenseId.get(exp.id)!.category_name
                                  } (${Math.round(
                                    suggestionsByExpenseId.get(exp.id)!.confidence * 100,
                                  )}%)`}
                                >
                                  ✨ {suggestionsByExpenseId.get(exp.id)!.category_name}
                                </button>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const s = suggestionsByExpenseId.get(exp.id)!;
                                    await rejectSuggestion(s.id);
                                    refetchSuggestions();
                                  }}
                                  className="text-[var(--text-tertiary)] hover:text-red-500 transition text-xs"
                                  title="Descartar sugerencia"
                                >
                                  ✗
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setQuickEdit({ expenseId: exp.id, type: "category", rect });
                                }}
                                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition text-xs px-1 py-0.5 rounded hover:bg-[var(--color-base-alt)]"
                                title="Asignar categoría"
                              >
                                —
                              </button>
                            )}
                          </td>
                          {/* Cuenta column */}
                          <td className="px-3 py-3 hidden md:table-cell">
                            {(() => {
                              const cuentaTag = exp.tags?.find((t) => t.group_name === "cuenta");
                              return cuentaTag ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setQuickEdit({ expenseId: exp.id, type: "cuenta", rect });
                                  }}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] hover:ring-1 hover:ring-[var(--color-primary)]/40 transition"
                                  style={{
                                    backgroundColor: cuentaTag.color + "1F",
                                    color: "var(--text-primary)",
                                  }}
                                  title="Cambiar cuenta"
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: cuentaTag.color }}
                                  />
                                  <span className="truncate max-w-[90px]">{cuentaTag.name}</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setQuickEdit({ expenseId: exp.id, type: "cuenta", rect });
                                  }}
                                  className="text-[var(--text-tertiary)] text-xs hover:text-[var(--text-primary)] transition px-1 py-0.5 rounded hover:bg-[var(--color-base-alt)]"
                                  title="Asignar cuenta"
                                >
                                  —
                                </button>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailExpense(exp);
                              }}
                              className="text-right hover:text-primary transition"
                            >
                              <span
                                className={`font-semibold whitespace-nowrap ${
                                  exp.is_income
                                    ? "text-[var(--color-success)]"
                                    : "text-[var(--text-primary)]"
                                }`}
                              >
                                {formatCurrency(exp.amount, exp.currency)}
                              </span>
                            </button>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  });
                })()
              )}
            </tbody>
          </table>
        </div>
      </div>

      {expenses.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-[var(--text-tertiary)]" aria-live="polite">
            {paginationLabel(expenses.length, expenseStats?.count)}
          </p>
          {hasMorePages(expenses.length, expenseStats?.count, visibleCount) && (
            <button
              onClick={() => setVisibleCount((prev) => prev + 100)}
              className="text-xs text-[var(--color-primary)] hover:underline font-medium"
            >
              Ver más gastos
            </button>
          )}
        </div>
      )}

      {selectedCount > 0 && (
        <BulkActionBar
          count={selectedCount}
          summary={selectedSummary}
          pending={bulkPending}
          onCategory={(rect) => setBulkPicker({ type: "category", rect })}
          onCuenta={(rect) => {
            if (cuentaTags.length === 0) {
              showToast("No hay cuentas configuradas", "info", 4000, "bottom-center");
              return;
            }
            setBulkPicker({ type: "cuenta", rect });
          }}
          onTags={(rect) => {
            if (otrosTags.length === 0) {
              showToast("No hay etiquetas configuradas", "info", 4000, "bottom-center");
              return;
            }
            setBulkPicker({ type: "tags", rect });
          }}
          onExport={exportSelected}
          onDelete={() => setBulkDeleteConfirm(true)}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      {bulkPicker?.type === "category" && (
        <QuickEditPopover
          triggerRect={bulkPicker.rect}
          onClose={() => setBulkPicker(null)}
          searchPlaceholder="Buscar categoría…"
          clearLabel="Sin categoría"
          groups={categoryGroupOptions(categories)}
          onSelect={applyBulkCategory}
        />
      )}

      {bulkPicker?.type === "cuenta" && (
        <QuickEditPopover
          triggerRect={bulkPicker.rect}
          onClose={() => setBulkPicker(null)}
          searchPlaceholder="Buscar cuenta…"
          clearLabel="Sin cuenta"
          options={cuentaTags.map((tag) => ({
            value: String(tag.id),
            label: tag.name,
            color: tag.color,
          }))}
          onSelect={applyBulkCuenta}
        />
      )}

      {bulkPicker?.type === "tags" && (
        <BulkTagPicker
          triggerRect={bulkPicker.rect}
          tags={otrosTags}
          selectedExpenses={selectedExpenses}
          onApply={applyBulkTags}
          onClose={() => setBulkPicker(null)}
          isPending={bulkPending}
        />
      )}

      {detailExpense && (
        <ExpenseDetailModal
          expense={detailExpense}
          onClose={() => setDetailExpense(null)}
          onEdit={() => {
            setDetailExpense(null);
            setEditing(detailExpense);
          }}
        />
      )}

      {editing !== undefined && (
        <ExpenseModal
          initial={editing}
          onClose={() => {
            setEditing(undefined);
            setSaveError(null);
          }}
          onSave={handleSave}
          saveError={saveError}
          isSaving={createMut.isPending || updateMut.isPending}
        />
      )}

      {deleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          title="Confirmar eliminación"
          message={`¿Estás seguro de eliminar "${deleteConfirm.description}"?`}
          confirmLabel="Eliminar"
          onConfirm={() => {
            handleDelete(deleteConfirm.id, deleteConfirm.description);
            setDeleteConfirm(null);
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {bulkDeleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          title="Eliminar gastos"
          message={`¿Eliminar ${selectedCount} gasto${
            selectedCount !== 1 ? "s" : ""
          }${selectedSummary ? ` (${selectedSummary})` : ""}? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={deleteSelected}
          onCancel={() => setBulkDeleteConfirm(false)}
        />
      )}

      {quickEdit && (
        <QuickEditPopover
          triggerRect={quickEdit.rect}
          onClose={() => setQuickEdit(null)}
          value={
            quickEdit.type === "category"
              ? String(expenses.find((e) => e.id === quickEdit.expenseId)?.category_id ?? "")
              : String(
                  expenses
                    .find((e) => e.id === quickEdit.expenseId)
                    ?.tags?.find((t) => t.group_name === "cuenta")?.id ?? "",
                )
          }
          searchPlaceholder={
            quickEdit.type === "category" ? "Buscar categoría..." : "Buscar cuenta..."
          }
          clearLabel={quickEdit.type === "category" ? "Sin categoría" : "Sin cuenta"}
          options={
            quickEdit.type === "category"
              ? categories.map((c) => ({
                  value: String(c.id),
                  label: c.name,
                  color: c.color,
                }))
              : tags
                  .filter((t) => t.group_name === "cuenta")
                  .map((t) => ({ value: String(t.id), label: t.name, color: t.color }))
          }
          onSelect={(val) => {
            const id = quickEdit.expenseId;
            if (quickEdit.type === "category") {
              const catId = val === "__clear__" ? null : parseInt(val);
              quickUpdateMut.mutate({ id, field: "category_id", value: catId });
            } else {
              const tagId = val === "__clear__" ? null : parseInt(val);
              quickUpdateMut.mutate({ id, field: "cuenta", value: tagId });
            }
          }}
        />
      )}
    </div>
  );
}
