import { describe, it, expect } from "vitest";
import { buildFilterChips } from "./expenseFilterChips";
import type { ExpenseFilters } from "../hooks/useExpenseFilters";
import type { Category, Tag } from "../types";

const EMPTY: ExpenseFilters = {
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

const CATEGORIES = [
  { id: 1, name: "Salud", color: "#000", keywords: "" },
  { id: 2, name: "Transporte", color: "#111", keywords: "" },
] as Category[];

const TAGS = [
  { id: 9, name: "Visa", color: "#222", group_name: "cuenta" },
  { id: 10, name: "Viaje", color: "#333", group_name: "otros" },
] as Tag[];

describe("buildFilterChips", () => {
  it("is empty when no filter is active", () => {
    expect(buildFilterChips(EMPTY, CATEGORIES, TAGS)).toEqual([]);
  });

  it("labels search, categories and the date preset", () => {
    const chips = buildFilterChips(
      {
        ...EMPTY,
        q: "netflix",
        categoryIds: [1, 2],
        datePreset: "3m",
        dateFrom: "2026-08-01",
        dateTo: "2026-10-31",
      },
      CATEGORIES,
      TAGS,
    );

    expect(chips.map((chip) => chip.label)).toEqual([
      "«netflix»",
      "Salud",
      "Transporte",
      "Últimos 3 meses",
    ]);
    expect(chips.map((chip) => chip.kind)).toEqual(["search", "category", "category", "date"]);
  });

  it("labels uncategorized, account, tag and person filters", () => {
    const chips = buildFilterChips(
      {
        ...EMPTY,
        uncategorized: true,
        cuentaId: 9,
        untagged: true,
        person: "Ana",
      },
      CATEGORIES,
      TAGS,
    );

    expect(chips.map((chip) => chip.label)).toEqual([
      "Sin categoría",
      "Visa",
      "Sin etiqueta",
      "Titular: Ana",
    ]);
  });

  it("falls back to generic labels when the id is not loaded yet", () => {
    const chips = buildFilterChips(
      { ...EMPTY, categoryIds: [99], tagId: 88, cuentaId: 77 },
      [],
      [],
    );

    expect(chips.map((chip) => chip.label)).toEqual(["Categoría", "Cuenta", "Etiqueta"]);
  });

  it("shows a custom range with both dates", () => {
    const chips = buildFilterChips(
      { ...EMPTY, dateFrom: "2026-09-01", dateTo: "2026-09-15" },
      CATEGORIES,
      TAGS,
    );

    expect(chips[0].label).toBe("01-09-2026 – 15-09-2026");
  });
});
