import { useState, useMemo, useRef, useEffect, Fragment } from "react";
import { showToast } from "../utils/toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUndoToast } from "../hooks/useUndoToast";
import {
  getExpenses,
  getCategories,
  getTags,
  bulkUpdateTags,
  getExpenseStats,
  getExpensesByCategory,
  getExpensesByPerson,
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
import { Select } from "../components/ui/Select";
import { MultiSelect } from "../components/ui/MultiSelect";
import { ExpenseModal } from "../components/ExpenseModals";
import ExpenseDetailModal from "../components/ExpenseDetailModal";
import EmptyState from "../components/ui/EmptyState";
import SymbolicIcon from "../components/SymbolicIcon";
import QuickEditPopover from "../components/QuickEditPopover";
import BulkActionBar from "../components/BulkActionBar";
import BulkTagPicker from "../components/BulkTagPicker";
import { getCategoryIcon } from "../utils/categoryIcon";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  formatCurrency,
  titleCase,
  SortIcon,
  categoryGroupOptions,
  formatDateDMY,
} from "../utils/format";
import { useExpenseFilters } from "../hooks/useExpenseFilters";
import { ConfirmDialog } from "../components/ConfirmDialog";

type SortField = "date" | "description" | "category" | "bank" | "person" | "amount";
type SortDir = "asc" | "desc";

function hasMissingData(exp: Expense): boolean {
  return !exp.category_id;
}

function groupSmallCategories(
  data: {
    category_name: string;
    category_color: string | null;
    total: number;
    count: number;
    category_id: number | null;
  }[],
  maxItems = 5,
) {
  if (data.length <= maxItems) return { shown: data, hidden: [], hiddenTotal: 0 };
  const shown = data.slice(0, maxItems);
  const hidden = data.slice(maxItems);
  const hiddenTotal = hidden.reduce((s, c) => s + c.total, 0);
  return { shown, hidden, hiddenTotal };
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

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const {
    filters,
    setFilter,
    setCategoryIds,
    clearFilters,
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

  const handleCategorySelection = (values: string[]) => {
    // "Sin categoría" is exclusive: it is not an id, and it cannot coexist with
    // a category selection.
    if (values.includes("__none__")) {
      const next = new URLSearchParams(searchParams);
      next.delete("category_id");
      next.delete("category_ids");
      next.set("uncategorized", "1");
      setSearchParams(next);
      return;
    }
    setCategoryIds(values.map(Number).filter((id) => Number.isInteger(id) && id > 0));
  };

  // Drilldowns (a slice of the donut, a category row) replace the whole
  // selection with the one category they were clicked for.
  const handleCategoryFilter = (value: string) => {
    handleCategorySelection(value ? [value] : []);
  };

  const activeFiltersCount = [
    filterCategoryIds.length > 0 || filterUncategorized || undefined,
    filterPerson,
    filterDateFrom,
    filterDateTo,
    filterTagId || undefined,
    filterUntagged || undefined,
    filterCuentaId || undefined,
    filterSinCuenta || undefined,
    filterSearch,
  ].filter(Boolean).length;

  const [visibleCount, setVisibleCount] = useState(100);

  // Reset visible count when filters change
  const filterKey = `${filterCategoryIds.join(",")}-${filterUncategorized}-${filterPerson}-${filterDateFrom}-${filterDateTo}-${filterTagId}-${filterUntagged}-${filterCuentaId}-${filterSinCuenta}-${filterSearch}`;
  const prevFilterKey = useRef(filterKey);
  if (filterKey !== prevFilterKey.current) {
    prevFilterKey.current = filterKey;
    setVisibleCount(100);
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["expenses-list"] });

  const { data: expenses = [], isLoading } = useQuery<Expense[]>({
    queryKey: ["expenses-list", filterKey, visibleCount],
    queryFn: () => getExpenses({ ...filterParams, limit: visibleCount }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
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

  const { data: expenseStats } = useQuery({
    queryKey: ["expense-stats", filterKey],
    queryFn: () => getExpenseStats(filterParams),
  });

  const { data: categoryBreakdown = [] } = useQuery({
    queryKey: ["expenses-by-category", filterKey],
    queryFn: () => getExpensesByCategory(filterParams),
  });

  const { data: personBreakdown = [] } = useQuery({
    queryKey: ["expenses-by-person", filterKey],
    queryFn: () => getExpensesByPerson(filterParams),
  });

  const [editing, setEditing] = useState<Expense | null | undefined>(undefined);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [selectedDonutCategory, setSelectedDonutCategory] = useState<string | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({
    field: "date",
    dir: "desc",
  });
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
      const queryKey = [
        "expenses-list",
        filterCategoryIds.join(","),
        filterUncategorized,
        filterPerson,
        filterDateFrom,
        filterDateTo,
        filterTagId,
        filterUntagged,
        filterCuentaId,
        filterSinCuenta,
        visibleCount,
      ];
      const previous = queryClient.getQueryData<Expense[]>(queryKey);
      queryClient.setQueryData<Expense[]>(queryKey, (old) =>
        (old ?? []).map((e) => {
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
        }),
      );
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
          [
            "expenses-list",
            filterCategoryIds.join(","),
            filterUncategorized,
            filterPerson,
            filterDateFrom,
            filterDateTo,
            filterTagId,
          ],
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

  const filterChips: { key: string; label: string; clear: () => void }[] = [];
  if (filterSearch) {
    filterChips.push({
      key: "q",
      label: `«${filterSearch}»`,
      clear: () => {
        setSearchInput("");
        setFilter("q", undefined);
      },
    });
  }
  if (filterCategoryIds.length > 0) {
    for (const id of filterCategoryIds) {
      filterChips.push({
        key: `category-${id}`,
        label: categories.find((category) => category.id === id)?.name ?? "Categoría",
        clear: () =>
          handleCategorySelection(filterCategoryIds.filter((other) => other !== id).map(String)),
      });
    }
  }
  if (filterUncategorized) {
    filterChips.push({
      key: "uncategorized",
      label: "Sin categoría",
      clear: () => handleCategorySelection([]),
    });
  }
  if (filterCuentaId) {
    filterChips.push({
      key: "cuenta",
      label: tags.find((tag) => tag.id === filterCuentaId)?.name ?? "Cuenta",
      clear: () => setFilter("cuenta_id", undefined),
    });
  }
  if (filterSinCuenta) {
    filterChips.push({
      key: "sin_cuenta",
      label: "Sin cuenta",
      clear: () => setFilter("sin_cuenta", undefined),
    });
  }
  if (filterTagId) {
    filterChips.push({
      key: "tag",
      label: tags.find((tag) => tag.id === filterTagId)?.name ?? "Etiqueta",
      clear: () => setFilter("tag_id", undefined),
    });
  }
  if (filterUntagged) {
    filterChips.push({
      key: "untagged",
      label: "Sin etiqueta",
      clear: () => setFilter("untagged", undefined),
    });
  }
  if (filterDateFrom) {
    filterChips.push({
      key: "date_from",
      label: `Desde ${formatDateDMY(filterDateFrom)}`,
      clear: () => setFilter("date_from", undefined),
    });
  }
  if (filterDateTo) {
    filterChips.push({
      key: "date_to",
      label: `Hasta ${formatDateDMY(filterDateTo)}`,
      clear: () => setFilter("date_to", undefined),
    });
  }
  if (filterPerson) {
    filterChips.push({
      key: "person",
      label: `Titular: ${filterPerson}`,
      clear: () => setFilter("person", undefined),
    });
  }

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

      {/* Filters — the description search lives inside this section (issue #420) */}
      <div className="card" data-testid="expense-filters">
        <div className="space-y-3 p-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchInput("");
                }}
                placeholder="Buscar por descripción, nota o categoría…"
                aria-label="Buscar gastos"
                className="input text-sm pl-8 pr-8"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tertiary">
                <SymbolicIcon name="search" size={14} />
              </span>
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  aria-label="Limpiar búsqueda"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-tertiary hover:text-primary transition"
                >
                  ×
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              aria-expanded={filtersExpanded}
              aria-controls="expense-filter-fields"
              className="gnome-btn-secondary-round shrink-0 px-3 text-sm"
            >
              <span className="flex items-center gap-1.5">
                Filtros
                {activeFiltersCount > 0 && (
                  <span className="rounded-full bg-[var(--color-primary)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--color-on-primary)]">
                    {activeFiltersCount}
                  </span>
                )}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                  className={`transition-transform ${filtersExpanded ? "rotate-180" : ""}`}
                >
                  <path
                    d="M3 4.5L6 7.5L9 4.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          </div>

          {filterSearch && (
            <p className="text-xs text-secondary" aria-live="polite">
              {`${expenses.length}${expenses.length >= visibleCount ? "+" : ""} gastos para «${filterSearch}»`}
            </p>
          )}

          {activeFiltersCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {filterChips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--color-base-alt)] px-2 py-0.5 text-xs text-[var(--text-primary)]"
                >
                  {chip.label}
                  <button
                    type="button"
                    onClick={chip.clear}
                    aria-label={`Quitar filtro ${chip.label}`}
                    className="text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-full border border-[var(--color-primary)] px-2.5 py-1 text-xs text-[var(--color-primary)] transition hover:bg-[var(--color-primary)]/10"
              >
                Limpiar ({activeFiltersCount})
              </button>
            </div>
          )}

          {filtersExpanded && (
            <div id="expense-filter-fields" className="border-t border-[var(--border-color)] pt-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {/* Categoría */}
                {/* Categoría — multi-select: several categories can be on at once. */}
                <MultiSelect
                  values={filterUncategorized ? ["__none__"] : filterCategoryIds.map(String)}
                  onChange={handleCategorySelection}
                  options={[{ value: "__none__", label: "Sin categoría" }]}
                  groups={categoryGroupOptions(categories)}
                  placeholder="Categoría"
                />

                {/* Cuenta */}
                {(() => {
                  const cuentaTags = tags.filter((t) => t.group_name === "cuenta");
                  const options: { value: string; label: string }[] = [
                    { value: "", label: "Todas" },
                    { value: "__sin_cuenta__", label: "Sin cuenta" },
                    ...cuentaTags.map((t) => ({ value: String(t.id), label: t.name })),
                  ];
                  const currentValue = filterSinCuenta
                    ? "__sin_cuenta__"
                    : filterCuentaId
                      ? String(filterCuentaId)
                      : "";
                  return (
                    <Select
                      value={currentValue}
                      onChange={(v) => {
                        const next = new URLSearchParams(searchParams);
                        if (v === "__sin_cuenta__") {
                          next.set("sin_cuenta", "1");
                          next.delete("cuenta_id");
                        } else if (v) {
                          next.set("cuenta_id", v);
                          next.delete("sin_cuenta");
                        } else {
                          next.delete("cuenta_id");
                          next.delete("sin_cuenta");
                        }
                        setSearchParams(next);
                      }}
                      options={options}
                      placeholder="Cuenta"
                    />
                  );
                })()}

                {/* Etiqueta */}
                {(() => {
                  const otrosTags = tags.filter((t) => t.group_name === "otros");
                  const options: { value: string; label: string }[] = [
                    { value: "", label: "Todas" },
                    { value: "__untagged__", label: "Sin etiqueta" },
                    ...otrosTags.map((t) => ({ value: String(t.id), label: t.name })),
                  ];
                  const currentTag = filterUntagged
                    ? "__untagged__"
                    : filterTagId
                      ? String(filterTagId)
                      : "";
                  return (
                    <Select
                      value={currentTag}
                      onChange={(v) => {
                        const next = new URLSearchParams(searchParams);
                        if (v === "__untagged__") {
                          next.set("untagged", "1");
                          next.delete("tag_id");
                        } else if (v) {
                          next.set("tag_id", v);
                          next.delete("untagged");
                        } else {
                          next.delete("tag_id");
                          next.delete("untagged");
                        }
                        setSearchParams(next);
                      }}
                      options={options}
                      placeholder="Etiqueta"
                    />
                  );
                })()}

                {/* Desde */}
                <input
                  type="date"
                  value={filterDateFrom ?? ""}
                  onChange={(e) => setFilter("date_from", e.target.value || undefined)}
                  className="text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  placeholder="Desde"
                />

                {/* Hasta */}
                <input
                  type="date"
                  value={filterDateTo ?? ""}
                  onChange={(e) => setFilter("date_to", e.target.value || undefined)}
                  className="text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  placeholder="Hasta"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stats cards + Charts */}
      {expenses.length > 0 &&
        (() => {
          const arsExpenses = expenses.filter((e) => (e.currency || "ARS") === "ARS");
          const arsTotal = expenseStats?.total ?? arsExpenses.reduce((s, e) => s + e.amount, 0);
          const totalCount = expenseStats?.count ?? expenses.length;
          const avg =
            expenseStats?.avg ?? (arsExpenses.length > 0 ? arsTotal / arsExpenses.length : 0);
          const max = arsExpenses.length > 0 ? Math.max(...arsExpenses.map((e) => e.amount)) : 0;
          return (
            <>
              {/* Stats cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="card p-3">
                  <p className="text-[10px] text-tertiary uppercase">Total</p>
                  <p className="text-lg font-bold text-primary">{formatCurrency(arsTotal)}</p>
                </div>
                <div className="card p-3">
                  <p className="text-[10px] text-tertiary uppercase">Gastos</p>
                  <p className="text-lg font-bold text-primary">{totalCount}</p>
                </div>
                <div className="card p-3">
                  <p className="text-[10px] text-tertiary uppercase">Promedio</p>
                  <p className="text-lg font-bold text-primary">{formatCurrency(avg)}</p>
                </div>
                <div className="card p-3">
                  <p className="text-[10px] text-tertiary uppercase">Mayor gasto</p>
                  <p className="text-lg font-bold text-primary">{formatCurrency(max)}</p>
                </div>
              </div>

              {/* Charts row */}
              {categoryBreakdown.length > 0 &&
                (() => {
                  const { shown, hidden, hiddenTotal } = groupSmallCategories(
                    categoryBreakdown,
                    12,
                  );
                  const displayCategories = showAllCategories ? categoryBreakdown : shown;
                  const pieData = [
                    ...displayCategories.map((c) => ({
                      name: c.category_name,
                      value: c.total,
                      color: c.category_color,
                      categoryId: c.category_id,
                    })),
                    ...(!showAllCategories && hidden.length > 0
                      ? [
                          {
                            name: `Otros (${hidden.length})`,
                            value: hiddenTotal,
                            color: "#94a3b8",
                            categoryId: null,
                          },
                        ]
                      : []),
                  ];
                  return (
                    <div className="card p-4">
                      <h3 className="text-sm font-medium text-secondary mb-3">Por Categoría</h3>
                      <div className="flex flex-col sm:flex-row items-center gap-4">
                        <ResponsiveContainer width={200} height={200}>
                          <PieChart>
                            <Pie
                              data={pieData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              outerRadius={80}
                              innerRadius={45}
                              paddingAngle={2}
                              onClick={(entry) => {
                                const name = entry.name;
                                if (name.startsWith("Otros")) return;
                                if (selectedDonutCategory === name) {
                                  setSelectedDonutCategory(null);
                                  handleCategoryFilter("");
                                } else {
                                  setSelectedDonutCategory(name);
                                  const cat = categoryBreakdown.find(
                                    (c) => c.category_name === name,
                                  );
                                  if (cat?.category_id)
                                    handleCategoryFilter(String(cat.category_id));
                                }
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              {pieData.map((entry, i) => {
                                const isSelected = selectedDonutCategory === entry.name;
                                const isHighlighted = selectedDonutCategory ? isSelected : true;
                                return (
                                  <Cell
                                    key={i}
                                    fill={entry.color || "#94a3b8"}
                                    opacity={isHighlighted ? 1 : 0.3}
                                  />
                                );
                              })}
                            </Pie>
                            <Tooltip
                              formatter={(v: number) => formatCurrency(v)}
                              contentStyle={{ fontSize: 11, borderRadius: 6 }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="flex-1 max-h-[220px] overflow-y-auto grid grid-cols-2 gap-x-6 gap-y-1.5">
                          {displayCategories.map((cat, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                if (selectedDonutCategory === cat.category_name) {
                                  setSelectedDonutCategory(null);
                                  handleCategoryFilter("");
                                } else {
                                  setSelectedDonutCategory(cat.category_name);
                                  if (cat.category_id)
                                    handleCategoryFilter(String(cat.category_id));
                                }
                              }}
                              className={`flex items-center gap-2 text-xs text-left w-full rounded px-1 py-0.5 transition ${
                                selectedDonutCategory === cat.category_name
                                  ? "bg-[var(--color-primary)]/10"
                                  : "hover:bg-[var(--color-base-alt)]"
                              }`}
                            >
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{
                                  backgroundColor: cat.category_color || "#94a3b8",
                                }}
                              />
                              <span className="text-secondary truncate flex-1">
                                {cat.category_name}
                              </span>
                              <span className="text-primary font-medium whitespace-nowrap">
                                {formatCurrency(cat.total)}
                              </span>
                            </button>
                          ))}
                          {!showAllCategories && hidden.length > 0 && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="w-2 h-2 rounded-full flex-shrink-0 bg-[#94a3b8]" />
                              <span className="text-secondary truncate flex-1">
                                Otros ({hidden.length})
                              </span>
                              <span className="text-primary font-medium whitespace-nowrap">
                                {formatCurrency(hiddenTotal)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      {hidden.length > 0 && (
                        <button
                          onClick={() => setShowAllCategories(!showAllCategories)}
                          className="mt-2 text-xs text-[var(--color-primary)] hover:underline"
                        >
                          {showAllCategories
                            ? "Mostrar top 12"
                            : `Ver todas las ${categoryBreakdown.length} categorías`}
                        </button>
                      )}
                    </div>
                  );
                })()}

              {personBreakdown.length > 1 && (
                <div className="card p-4">
                  <h3 className="text-sm font-medium text-secondary mb-3">Por Titular</h3>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart
                      data={personBreakdown.slice(0, 5)}
                      layout="vertical"
                      margin={{ left: 10, right: 10, top: 0, bottom: 0 }}
                    >
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="person"
                        width={80}
                        tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                      />
                      <Tooltip
                        formatter={(v: number) => formatCurrency(v)}
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                      />
                      <Bar
                        dataKey="total"
                        fill="var(--color-primary)"
                        radius={[0, 4, 4, 0]}
                        barSize={16}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          );
        })()}

      <div className="card overflow-hidden">
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
                <th
                  className={thClass("date") + " hidden sm:table-cell"}
                  onClick={() =>
                    setSort({
                      field: "date",
                      dir: sort.dir === "asc" && sort.field === "date" ? "desc" : "asc",
                    })
                  }
                >
                  Fecha <SortIcon field="date" sort={sort} />
                </th>
                <th
                  className={thClass("description")}
                  onClick={() =>
                    setSort({
                      field: "description",
                      dir: sort.dir === "asc" && sort.field === "description" ? "desc" : "asc",
                    })
                  }
                >
                  Descripción <SortIcon field="description" sort={sort} />
                </th>
                <th
                  className={thClass("category") + " hidden sm:table-cell"}
                  onClick={() =>
                    setSort({
                      field: "category",
                      dir: sort.field === "category" && sort.dir === "asc" ? "desc" : "asc",
                    })
                  }
                >
                  Categoría <SortIcon field="category" sort={sort} />
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase hidden md:table-cell">
                  Cuenta
                </th>
                <th
                  className={thClass("amount")}
                  onClick={() =>
                    setSort({
                      field: "amount",
                      dir: sort.dir === "asc" && sort.field === "amount" ? "desc" : "asc",
                    })
                  }
                >
                  Monto <SortIcon field="amount" sort={sort} />
                </th>
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
                              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditing(exp);
                                  }}
                                  className="p-1 rounded text-[var(--text-tertiary)] hover:text-primary hover:bg-[var(--color-base-alt)] transition"
                                  title="Editar"
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
          <p className="text-xs text-[var(--text-tertiary)]">{expenses.length} gastos</p>
          {expenses.length >= visibleCount && (
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
