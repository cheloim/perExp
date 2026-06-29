import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUndoToast } from "../hooks/useUndoToast";
import {
  getExpenses,
  getCategories,
  getCards,
  getAccounts,
  getExpenseStats,
  getExpensesByCategory,
  getExpensesByPerson,
  createExpense,
  updateExpense,
  deleteExpense,
  bulkDeleteExpenses,
  bulkUpdateFields,
} from "../api/client";
import type { Expense, ExpenseCreate } from "../types";
import { Select } from "../components/ui/Select";
import { ExpenseModal } from "../components/ExpenseModals";
import ExpenseDetailModal from "../components/ExpenseDetailModal";
import EmptyState from "../components/ui/EmptyState";
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
  toUpperCase,
  titleCase,
  getContrastTextColor,
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

function getMissingDataFields(exp: Expense): string[] {
  const missing: string[] = [];
  if (!exp.category_id) missing.push("categoría");
  return missing;
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

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const { filters, setFilter, clearFilters, searchParams, setSearchParams } = useExpenseFilters();

  const filterCategory = filters.categoryId;
  const filterUncategorized = filters.uncategorized;
  const filterBank = filters.bank;
  const filterPerson = filters.person;
  const filterCard = filters.card;
  const filterAccount = filters.account;
  const filterDateFrom = filters.dateFrom;
  const filterDateTo = filters.dateTo;
  const filterSearch = filters.search;

  const now = new Date();
  const month = filterDateFrom
    ? `${filterDateFrom.substring(0, 7)}`
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const handleCategoryFilter = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "__none__") {
      next.set("uncategorized", "1");
      next.delete("category_id");
    } else if (value) {
      next.set("category_id", value);
      next.delete("uncategorized");
    } else {
      next.delete("category_id");
      next.delete("uncategorized");
    }
    setSearchParams(next);
  };

  const activeFiltersCount = [
    filterCategory,
    filterUncategorized || undefined,
    filterBank,
    filterPerson,
    filterCard,
    filterAccount,
    filterDateFrom,
    filterDateTo,
    filterSearch,
  ].filter(Boolean).length;

  const [visibleCount, setVisibleCount] = useState(100);

  // Reset visible count when filters change
  const filterKey = `${filterCategory}-${filterUncategorized}-${filterBank}-${filterPerson}-${filterCard}-${filterAccount}-${filterDateFrom}-${filterDateTo}-${filterSearch}`;
  const prevFilterKey = useRef(filterKey);
  if (filterKey !== prevFilterKey.current) {
    prevFilterKey.current = filterKey;
    setVisibleCount(100);
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["expenses"] });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: [
      "expenses",
      filterCategory,
      filterUncategorized,
      filterBank,
      filterPerson,
      filterCard,
      filterAccount,
      filterDateFrom,
      filterDateTo,
      filterSearch,
    ],
    queryFn: () =>
      getExpenses({
        category_id: filterCategory,
        uncategorized: filterUncategorized || undefined,
        bank: filterBank,
        person: filterPerson,
        card: filterCard,
        account: filterAccount,
        date_from: filterDateFrom,
        date_to: filterDateTo,
        search: filterSearch,
        limit: visibleCount,
      }),
  });

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: getCategories });

  // Prefetch cards and accounts so modal opens instantly
  const { data: cards = [] } = useQuery({
    queryKey: ["cards"],
    queryFn: getCards,
    staleTime: 300_000,
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
    staleTime: 300_000,
  });

  // Combined card/account list for bulk selection
  const cardAccountOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    cards.forEach((c) => {
      opts.push({ value: `card:${c.id}`, label: `${c.bank} - ${c.card_name}` });
    });
    accounts.forEach((a) => {
      opts.push({ value: `account:${a.id}`, label: a.name });
    });
    return opts;
  }, [cards, accounts]);

  // Analytics queries
  const { data: expenseStats } = useQuery({
    queryKey: ["expense-stats", month, filterCategory, filterCard, filterAccount],
    queryFn: () =>
      getExpenseStats({
        month: month || undefined,
        card: filterCard || undefined,
        account: filterAccount || undefined,
      }),
  });

  const { data: categoryBreakdown = [] } = useQuery({
    queryKey: ["expenses-by-category", month],
    queryFn: () => getExpensesByCategory({ month: month || undefined }),
  });

  const { data: personBreakdown = [] } = useQuery({
    queryKey: ["expenses-by-person", month],
    queryFn: () => getExpensesByPerson({ month: month || undefined }),
  });

  // Categories that match the current search term
  const matchingCategories = useMemo(() => {
    if (!filterSearch || expenses.length === 0) return new Set<number>();
    const ids = new Set<number>();
    expenses.forEach((e) => {
      if (e.category_id != null) ids.add(e.category_id);
    });
    return ids;
  }, [filterSearch, expenses]);

  const [editing, setEditing] = useState<Expense | null | undefined>(undefined);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(filterSearch ?? "");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [selectedDonutCategory, setSelectedDonutCategory] = useState<string | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync debouncedSearch when filterSearch changes externally (e.g., clear filters)
  useEffect(() => {
    setDebouncedSearch(filterSearch ?? "");
  }, [filterSearch]);

  const handleSearchChange = useCallback(
    (value: string) => {
      clearTimeout(searchTimeout.current);
      searchTimeout.current = setTimeout(() => {
        setFilter("search", value || undefined);
      }, 300);
      setDebouncedSearch(value);
    },
    [setFilter],
  );
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({
    field: "date",
    dir: "desc",
  });
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("");
  const [bulkPaymentMethod, setBulkPaymentMethod] = useState<string>("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; description: string } | null>(
    null,
  );
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  const clearBulkState = () => {
    setDrawerOpen(false);
    setSelectedIds(new Set());
    setBulkCategoryId("");
    setBulkPaymentMethod("");
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      if (next.size > 0) setDrawerOpen(true);
      else setDrawerOpen(false);
      return next;
    });
  };

  const bulkFieldMut = useMutation({
    mutationFn: ({
      ids,
      ...updateData
    }: {
      ids: number[];
      category_id?: number | null;
      card_id?: number | null;
      account_id?: number | null;
    }) => bulkUpdateFields(ids, updateData),
    onSuccess: () => {
      invalidate();
      clearBulkState();
    },
    onError: (e: Error) => {
      console.error("Bulk update failed:", e);
      setSaveError("Error al actualizar");
    },
  });

  const handleBulkApply = () => {
    if (selectedIds.size === 0) return;
    const updateData: {
      category_id?: number | null;
      card_id?: number | null;
      account_id?: number | null;
    } = {};
    if (bulkCategoryId !== "") {
      updateData.category_id = bulkCategoryId === "__none__" ? null : parseInt(bulkCategoryId);
    }
    if (bulkPaymentMethod) {
      const [type, id] = bulkPaymentMethod.split(":");
      if (type === "card") updateData.card_id = parseInt(id);
      else if (type === "account") updateData.account_id = parseInt(id);
    }
    if (Object.keys(updateData).length === 0) return;
    bulkFieldMut.mutate({ ids: Array.from(selectedIds), ...updateData });
  };

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: number[]) => bulkDeleteExpenses(ids),
    onSuccess: () => {
      invalidate();
      clearBulkState();
      setBulkDeleteConfirm(false);
    },
    onError: (e: Error) => {
      console.error("Bulk delete failed:", e);
      setSaveError("Error al eliminar");
      setBulkDeleteConfirm(false);
    },
  });

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

  const deleteMut = useMutation({
    mutationFn: deleteExpense,
    onSuccess: invalidate,
  });

  const { show: showUndo, ToastContainer } = useUndoToast();
  const pendingDeletes = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const handleDelete = (id: number, description: string) => {
    const timer = setTimeout(() => {
      deleteMut.mutate(id);
      pendingDeletes.current.delete(id);
    }, 5000);
    pendingDeletes.current.set(id, timer);

    showUndo(
      `"${description}" eliminado`,
      () => {}, // close callback
      () => {
        // Undo: cancel the pending delete
        const t = pendingDeletes.current.get(id);
        if (t) {
          clearTimeout(t);
          pendingDeletes.current.delete(id);
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

  const exportCSV = async () => {
    // Fetch all matching records for export
    const allData = await getExpenses({
      category_id: filterCategory,
      uncategorized: filterUncategorized || undefined,
      bank: filterBank,
      person: filterPerson,
      card: filterCard,
      date_from: filterDateFrom,
      date_to: filterDateTo,
      search: filterSearch,
      limit: 10000,
    });
    const headers = [
      "Fecha",
      "Descripción",
      "Monto",
      "Moneda",
      "Categoría",
      "Banco",
      "Tarjeta",
      "Persona",
    ];
    const rows = allData.map((e) => [
      e.date,
      `"${e.description.replace(/"/g, '""')}"`,
      e.amount,
      e.currency || "ARS",
      e.category_name || "",
      e.bank || "",
      e.card || "",
      e.person || "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gastos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Gastos</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setSelectMode((v) => !v);
              clearBulkState();
            }}
            className={`gnome-btn-secondary-round text-sm ${
              selectMode
                ? "bg-[var(--color-primary)] text-[var(--color-on-primary)] border-transparent hover:bg-[var(--color-primary)] hover:text-[var(--color-on-primary)] hover:border-transparent hover:shadow-md"
                : ""
            }`}
          >
            {selectMode ? "Cancelar" : "Seleccionar"}
          </button>
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

      {/* Filter panel - collapsible */}
      <div className="card">
        <button
          onClick={() => setFiltersExpanded(!filtersExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--color-base-alt)] transition"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">Filtros</span>
            {activeFiltersCount > 0 && (
              <span className="bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[10px] px-1.5 py-0.5 rounded-full">
                {activeFiltersCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeFiltersCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearFilters();
                }}
                className="text-xs px-2.5 py-1 rounded-full border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition"
              >
                Limpiar ({activeFiltersCount})
              </button>
            )}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
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
          </div>
        </button>
        {filtersExpanded && (
          <div className="px-4 pb-4 space-y-3 border-t border-[var(--border-color)]">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 pt-3">
              {/* Categoría */}
              {(() => {
                const groups = categoryGroupOptions(categories);
                return (
                  <Select
                    value={
                      filterUncategorized
                        ? "__none__"
                        : filterCategory
                        ? String(filterCategory)
                        : ""
                    }
                    onChange={(v) => handleCategoryFilter(v)}
                    options={[{ value: "__none__", label: "Sin categoría" }]}
                    groups={groups}
                    placeholder="Categoría"
                  />
                );
              })()}

              {/* Cuenta (Banco + Tarjeta unificados) */}
              {(() => {
                const cuentaOptions: { value: string; label: string }[] = [];
                // Cards from API: "Bank - Card"
                cards.forEach((c) => {
                  cuentaOptions.push({
                    value: `card:${c.id}`,
                    label: `${c.bank} - ${c.card_name}`,
                  });
                });
                // Accounts from API: just name
                accounts.forEach((a) => {
                  cuentaOptions.push({ value: `account:${a.id}`, label: a.name });
                });
                // Reconstruct current value from URL params by looking up matching card/account
                const matchedCard = filterCard
                  ? cards.find((c) => c.card_name === filterCard)
                  : null;
                const matchedAccount = filterAccount
                  ? accounts.find((a) => a.name === filterAccount)
                  : null;
                const currentCuenta = matchedCard
                  ? `card:${matchedCard.id}`
                  : matchedAccount
                  ? `account:${matchedAccount.id}`
                  : "";
                return (
                  <Select
                    value={currentCuenta}
                    onChange={(v) => {
                      if (v.startsWith("card:")) {
                        const cardId = v.replace("card:", "");
                        const found = cards.find((c) => String(c.id) === cardId);
                        // Combined update to avoid stale searchParams
                        const next = new URLSearchParams(searchParams);
                        if (found?.card_name) next.set("card", found.card_name);
                        else next.delete("card");
                        next.delete("account");
                        setSearchParams(next);
                      } else if (v.startsWith("account:")) {
                        const accountId = v.replace("account:", "");
                        const found = accounts.find((a) => String(a.id) === accountId);
                        const next = new URLSearchParams(searchParams);
                        if (found?.name) next.set("account", found.name);
                        else next.delete("account");
                        next.delete("card");
                        setSearchParams(next);
                      } else {
                        const next = new URLSearchParams(searchParams);
                        next.delete("card");
                        next.delete("account");
                        setSearchParams(next);
                      }
                    }}
                    options={cuentaOptions}
                    placeholder="Cuenta"
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

            {/* Search */}
            <input
              type="text"
              value={debouncedSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Buscar en descripción..."
              className="w-full text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition placeholder:text-[var(--text-tertiary)]"
            />
          </div>
        )}
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
                                const isSearchMatch =
                                  filterSearch &&
                                  matchingCategories.size > 0 &&
                                  entry.categoryId != null &&
                                  matchingCategories.has(entry.categoryId);
                                const isHighlighted = selectedDonutCategory
                                  ? isSelected
                                  : filterSearch
                                  ? isSearchMatch
                                  : true;
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
                                  : filterSearch &&
                                    cat.category_id != null &&
                                    matchingCategories.has(cat.category_id)
                                  ? "bg-[var(--color-primary)]/5"
                                  : "hover:bg-[var(--color-base-alt)]"
                              }`}
                            >
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: cat.category_color || "#94a3b8" }}
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
                {selectMode && (
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={expenses.length > 0 && selectedIds.size === expenses.length}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? new Set<number>(expenses.map((x) => x.id))
                          : new Set<number>();
                        setSelectedIds(next);
                        setDrawerOpen(next.size > 0);
                      }}
                      className="accent-[var(--color-primary)]"
                    />
                  </th>
                )}
                <th
                  className={thClass("date")}
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
                  className={thClass("category")}
                  onClick={() =>
                    setSort({
                      field: "category",
                      dir: sort.field === "category" && sort.dir === "asc" ? "desc" : "asc",
                    })
                  }
                >
                  Categoría <SortIcon field="category" sort={sort} />
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
                {!selectMode && (
                  <th className="px-4 py-3 text-center text-xs font-medium text-[var(--text-secondary)] uppercase">
                    Acciones
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-color)]">
              {isLoading ? (
                <>
                  {[...Array(8)].map((_, i) => (
                    <tr key={i} className="border-b border-[var(--border-color)]">
                      <td className="px-4 py-3">
                        <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse w-16" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse w-40" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse w-20" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse w-16" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 bg-[var(--color-base-alt)] rounded animate-pulse w-12" />
                      </td>
                    </tr>
                  ))}
                </>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-4">
                    <EmptyState
                      icon="📋"
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
                          : { label: "Crear gasto", onClick: () => setEditing(null) }
                      }
                    />
                  </td>
                </tr>
              ) : (
                (() => {
                  let lastDate = "";
                  return sortedExpenses.map((exp) => {
                    const missing = hasMissingData(exp);
                    const showDateHeader = exp.date !== lastDate;
                    if (showDateHeader) lastDate = exp.date;
                    return (
                      <Fragment key={exp.id}>
                        {showDateHeader && (
                          <tr key={`date-${exp.date}`}>
                            <td
                              colSpan={5}
                              className="px-4 py-2 text-xs font-medium text-[var(--text-tertiary)] bg-[var(--color-base-alt)]"
                            >
                              {formatDateDMY(exp.date)}
                            </td>
                          </tr>
                        )}
                        <tr
                          key={exp.id}
                          className={`transition-colors ${
                            selectMode
                              ? "cursor-pointer hover:bg-[var(--color-base-alt)]/50"
                              : "hover:bg-[var(--color-base-alt)]/30"
                          } ${selectedIds.has(exp.id) ? "bg-[var(--color-primary)]/10" : ""}`}
                          style={missing ? { borderLeft: "3px solid #f6d32d" } : undefined}
                          onClick={() =>
                            selectMode ? toggleSelect(exp.id) : setDetailExpense(exp)
                          }
                        >
                          {selectMode && (
                            <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedIds.has(exp.id)}
                                onChange={() => toggleSelect(exp.id)}
                                className="accent-[var(--color-primary)]"
                              />
                            </td>
                          )}
                          <td className="px-4 py-3 text-[var(--text-tertiary)] whitespace-nowrap">
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
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {missing && (
                                <span
                                  title={`Faltan: ${getMissingDataFields(exp).join(", ")}`}
                                  className="text-[#f6d32d]"
                                >
                                  ⚠️
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDetailExpense(exp);
                                }}
                                className="text-left hover:text-primary transition"
                              >
                                <span className="text-[var(--text-primary)]">
                                  {toUpperCase(exp.description)}
                                </span>
                                {exp.installment_number && exp.installment_total && (
                                  <span className="text-xs bg-[var(--color-primary)] text-[var(--color-on-primary)] px-1.5 py-0.5 rounded ml-1">
                                    {exp.installment_number}/{exp.installment_total}
                                  </span>
                                )}
                              </button>
                            </div>
                            <div className="text-xs text-[var(--text-tertiary)] flex gap-1 items-center">
                              {exp.card && <span>{titleCase(exp.card)}</span>}
                              {exp.card && exp.bank && <span>·</span>}
                              {exp.bank && <span>{titleCase(exp.bank)}</span>}
                              {(exp.card || exp.bank) && exp.person && <span>·</span>}
                              {exp.person && <span>{titleCase(exp.person)}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailExpense(exp);
                              }}
                              className="text-left"
                            >
                              {exp.category_name ? (
                                <span
                                  className="px-2 py-1 rounded text-xs font-medium"
                                  style={{
                                    backgroundColor: (exp.category_color || "#9a9996") + "20",
                                    color: getContrastTextColor(exp.category_color || "#9a9996"),
                                  }}
                                >
                                  {exp.category_name}
                                </span>
                              ) : (
                                <span className="text-[var(--text-tertiary)]">—</span>
                              )}
                            </button>
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
                              <span className="text-[var(--text-primary)]">
                                {formatCurrency(exp.amount, exp.currency)}
                              </span>
                            </button>
                          </td>
                          {!selectMode && (
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => {
                                    setEditing(exp);
                                  }}
                                  className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-primary hover:bg-[var(--color-base-alt)] transition"
                                  title="Editar"
                                >
                                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                    <path
                                      d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z"
                                      stroke="currentColor"
                                      strokeWidth="1.2"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                                <button
                                  onClick={() =>
                                    setDeleteConfirm({ id: exp.id, description: exp.description })
                                  }
                                  className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-danger hover:bg-[var(--color-base-alt)] transition"
                                  title="Eliminar"
                                >
                                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
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
                            </td>
                          )}
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

      {/* Bulk Drawer */}
      {drawerOpen && selectedIds.size > 0 && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 transition-opacity"
            onClick={clearBulkState}
          />
          <div className="fixed right-0 top-0 z-50 h-full w-full sm:w-80 bg-[var(--color-surface)] border-l border-[var(--border-color)] shadow-gnome-lg flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Acciones en lote
                </h3>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {selectedIds.size} gasto{selectedIds.size !== 1 ? "s" : ""} seleccionado
                  {selectedIds.size !== 1 ? "s" : ""}
                </p>
              </div>
              <button
                onClick={clearBulkState}
                className="p-1.5 rounded-md hover:bg-[var(--color-base-alt)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 p-4 space-y-5">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Asignar categoría
                </label>
                <Select
                  value={bulkCategoryId}
                  onChange={setBulkCategoryId}
                  options={[{ value: "__none__", label: "Sin categoría" }]}
                  groups={categoryGroupOptions(categories)}
                  placeholder="Seleccionar..."
                />
              </div>
              {cardAccountOptions.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    Asignar tarjeta / cuenta
                  </label>
                  <Select
                    value={bulkPaymentMethod}
                    onChange={setBulkPaymentMethod}
                    options={cardAccountOptions}
                    placeholder="Seleccionar..."
                  />
                </div>
              )}
            </div>

            <div className="p-4 border-t border-[var(--border-color)] flex gap-2">
              <button
                onClick={handleBulkApply}
                disabled={bulkFieldMut.isPending || bulkCategoryId === ""}
                className="flex-1 px-4 py-2 rounded-md bg-[var(--color-primary)] text-[var(--color-on-primary)] text-sm font-medium hover:brightness-110 disabled:opacity-50 transition"
              >
                {bulkFieldMut.isPending ? "Aplicando…" : "Aplicar cambios"}
              </button>
              <button
                onClick={() => setBulkDeleteConfirm(true)}
                disabled={bulkDeleteMut.isPending}
                className="flex-shrink-0 px-4 py-2 rounded-md border border-[var(--red-3,#e01b24)]/30 text-[var(--red-3,#e01b24)] hover:bg-[var(--red-3,#e01b24)]/10 text-sm font-medium transition disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="inline mr-1">
                  <path
                    d="M3 4h8M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M4.5 4v7a1 1 0 001 1h3a1 1 0 001-1V4"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Eliminar
              </button>
            </div>
          </div>
        </>
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
          message={`¿Eliminar ${selectedIds.size} gasto${
            selectedIds.size !== 1 ? "s" : ""
          }? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => {
            bulkDeleteMut.mutate(Array.from(selectedIds));
            setBulkDeleteConfirm(false);
          }}
          onCancel={() => setBulkDeleteConfirm(false)}
        />
      )}

      {ToastContainer}
    </div>
  );
}
