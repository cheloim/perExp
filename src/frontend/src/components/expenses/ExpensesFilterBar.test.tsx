import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExpensesFilterBar } from "./ExpensesFilterBar";
import type { ExpenseFilters } from "../../hooks/useExpenseFilters";
import type { FilterChip } from "../../utils/expenseFilterChips";
import type { Category, Tag } from "../../types";

const FILTERS: ExpenseFilters = {
  categoryIds: [],
  uncategorized: false,
  person: undefined,
  dateFrom: undefined,
  dateTo: undefined,
  datePreset: undefined,
  month: undefined,
  tagId: undefined,
  untagged: false,
  cuentaId: undefined,
  sinCuenta: false,
  q: undefined,
};

const CATEGORIES = [{ id: 1, name: "Salud", color: "#000", keywords: "" }] as Category[];
const TAGS = [
  { id: 9, name: "Visa", color: "#222", group_name: "cuenta" },
  { id: 10, name: "Viaje", color: "#333", group_name: "otros" },
] as Tag[];

const CHIPS: FilterChip[] = [
  { key: "q", label: "«netflix»", kind: "search" },
  { key: "category-1", label: "Salud", kind: "category", value: 1 },
];

function renderBar(overrides: Partial<React.ComponentProps<typeof ExpensesFilterBar>> = {}) {
  const onToggleExpanded = vi.fn();
  const onClearChip = vi.fn();
  const onClearAll = vi.fn();
  const onSearchInputChange = vi.fn();
  const utils = render(
    <ExpensesFilterBar
      filters={FILTERS}
      searchInput=""
      onSearchInputChange={onSearchInputChange}
      expanded={false}
      onToggleExpanded={onToggleExpanded}
      categories={CATEGORIES}
      tags={TAGS}
      chips={[]}
      resultSummary=""
      onCategoryChange={vi.fn()}
      onCuentaChange={vi.fn()}
      onTagChange={vi.fn()}
      onDateRangeChange={vi.fn()}
      onClearChip={onClearChip}
      onClearAll={onClearAll}
      {...overrides}
    />,
  );
  return { ...utils, onToggleExpanded, onClearChip, onClearAll, onSearchInputChange };
}

describe("ExpensesFilterBar", () => {
  it("keeps the search and the toggle in one row", () => {
    const { onToggleExpanded } = renderBar();

    expect(screen.getByRole("textbox", { name: "Buscar gastos" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Filtros/ }));
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);
  });

  it("hides the field grid while collapsed", () => {
    renderBar();

    expect(screen.queryByRole("button", { name: /Todas las categorías/ })).toBeNull();
  });

  it("shows the four unified controls when expanded", () => {
    renderBar({ expanded: true });

    expect(
      screen.getByRole("button", { name: /Categoría: Todas las categorías/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cuenta: Todas las cuentas/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Etiqueta: Todas las etiquetas/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cualquier fecha" })).toBeInTheDocument();
  });

  it("shows the active filters as chips and clears them one by one", () => {
    const { onClearChip } = renderBar({ chips: CHIPS });

    expect(screen.getByText("«netflix»")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtro Salud" }));

    expect(onClearChip).toHaveBeenCalledWith(CHIPS[1]);
  });

  it("clears every filter from the chip row", () => {
    const { onClearAll } = renderBar({ chips: CHIPS });

    fireEvent.click(screen.getByRole("button", { name: "Limpiar (2)" }));

    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("announces the result count politely when filters are active", () => {
    renderBar({ chips: CHIPS, resultSummary: "2+ gastos con los filtros aplicados" });

    expect(screen.getByText("2+ gastos con los filtros aplicados")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("clears the search box from its own button", () => {
    const { onSearchInputChange } = renderBar({ searchInput: "netflix" });

    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));

    expect(onSearchInputChange).toHaveBeenCalledWith("");
  });
});
