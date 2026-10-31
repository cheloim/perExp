import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  EXPENSES_FILTERS_KEY,
  persistFilters,
  readStoredFilters,
  useExpenseFilters,
} from "./useExpenseFilters";

const makeWrapper = (initial: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  };

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useExpenseFilters", () => {
  it("reads q from the URL", () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?q=farmacia"),
    });

    expect(result.current.filters.q).toBe("farmacia");
  });

  it("setFilter('q', ...) writes q to the URL", () => {
    const { result } = renderHook(() => useExpenseFilters(), { wrapper: makeWrapper("/") });

    act(() => result.current.setFilter("q", "netflix"));

    expect(result.current.searchParams.get("q")).toBe("netflix");
  });

  it("clearFilters drops q and resets the search input", () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?q=farmacia"),
    });

    act(() => result.current.clearFilters());

    expect(result.current.filters.q).toBeUndefined();
    expect(result.current.searchInput).toBe("");
  });

  it("test_q_updates_url_after_debounce", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useExpenseFilters(), { wrapper: makeWrapper("/") });

    act(() => result.current.setSearchInput("n"));
    act(() => result.current.setSearchInput("ne"));
    act(() => result.current.setSearchInput("netflix"));

    // one request per pause, not per keystroke
    expect(result.current.searchParams.get("q")).toBeNull();

    act(() => vi.advanceTimersByTime(300));

    expect(result.current.searchParams.get("q")).toBe("netflix");
  });

  it("clearing the input clears q after the debounce", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?q=farmacia"),
    });

    act(() => result.current.setSearchInput(""));
    act(() => vi.advanceTimersByTime(300));

    expect(result.current.filters.q).toBeUndefined();
    expect(result.current.searchParams.get("q")).toBeNull();
  });

  it("reads multiple categories from category_ids", () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?category_ids=3,7"),
    });

    expect(result.current.filters.categoryIds).toEqual([3, 7]);
  });

  it("reads a legacy single category_id as a one-item selection", () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?category_id=5"),
    });

    expect(result.current.filters.categoryIds).toEqual([5]);
  });

  it("drops entries that are not positive integers and de-duplicates", () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?category_ids=3,abc,3,-1,,7"),
    });

    expect(result.current.filters.categoryIds).toEqual([3, 7]);
  });

  it("setCategoryIds writes the comma list and removes the legacy param", () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?category_id=5&month=2026-10"),
    });

    act(() => result.current.setCategoryIds([2, 4]));

    expect(result.current.searchParams.get("category_ids")).toBe("2,4");
    expect(result.current.searchParams.get("category_id")).toBeNull();
    // Unrelated filters survive the change.
    expect(result.current.searchParams.get("month")).toBe("2026-10");
    expect(result.current.filters.categoryIds).toEqual([2, 4]);
  });

  it("choosing categories clears the uncategorized flag", () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?uncategorized=1"),
    });

    act(() => result.current.setCategoryIds([9]));

    expect(result.current.filters.uncategorized).toBe(false);
    expect(result.current.filters.categoryIds).toEqual([9]);
  });

  it("setCategoryIds([]) clears the category filter", () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?category_ids=2,4"),
    });

    act(() => result.current.setCategoryIds([]));

    expect(result.current.searchParams.get("category_ids")).toBeNull();
    expect(result.current.filters.categoryIds).toEqual([]);
  });

  it("reads a relative preset and resolves it to calendar months", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 31)); // 31 Oct 2026

    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?range=3m"),
    });

    expect(result.current.filters.datePreset).toBe("3m");
    expect(result.current.filters.dateFrom).toBe("2026-08-01");
    expect(result.current.filters.dateTo).toBe("2026-10-31");
  });

  it("derives dates from the legacy month param", () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?month=2026-02"),
    });

    expect(result.current.filters.month).toBe("2026-02");
    expect(result.current.filters.dateFrom).toBe("2026-02-01");
    expect(result.current.filters.dateTo).toBe("2026-02-28");
  });

  it("setDateRange stores the preset and drops month and custom dates", () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?month=2026-02&date_from=2026-01-01&date_to=2026-01-31"),
    });

    act(() => result.current.setDateRange({ preset: "6m" }));

    expect(result.current.searchParams.get("range")).toBe("6m");
    expect(result.current.searchParams.get("month")).toBeNull();
    expect(result.current.searchParams.get("date_from")).toBeNull();
    expect(result.current.searchParams.get("date_to")).toBeNull();
  });

  it("setDateRange stores a custom range as concrete dates", () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?range=3m"),
    });

    act(() => result.current.setDateRange({ from: "2026-09-01", to: "2026-09-15" }));

    expect(result.current.searchParams.get("range")).toBeNull();
    expect(result.current.searchParams.get("date_from")).toBe("2026-09-01");
    expect(result.current.searchParams.get("date_to")).toBe("2026-09-15");
    expect(result.current.filters.dateFrom).toBe("2026-09-01");
    expect(result.current.filters.dateTo).toBe("2026-09-15");
  });

  it("clearDateRange drops every way of expressing the range", () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?month=2026-02&range=3m"),
    });

    act(() => result.current.clearDateRange());

    expect(result.current.filters.dateFrom).toBeUndefined();
    expect(result.current.filters.dateTo).toBeUndefined();
    expect(result.current.filters.datePreset).toBeUndefined();
    expect(result.current.filters.month).toBeUndefined();
  });

  it("restores the session filters when the URL arrives empty", async () => {
    sessionStorage.setItem(EXPENSES_FILTERS_KEY, "category_ids=2,4&range=3m");

    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/"),
    });

    await waitFor(() => expect(result.current.searchParams.get("category_ids")).toBe("2,4"));
    expect(result.current.searchParams.get("range")).toBe("3m");
  });

  it("an explicit link wins over the session snapshot", async () => {
    sessionStorage.setItem(EXPENSES_FILTERS_KEY, "category_ids=2");

    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?q=netflix"),
    });

    expect(result.current.filters.q).toBe("netflix");
    expect(result.current.filters.categoryIds).toEqual([]);
    await waitFor(() => expect(readStoredFilters()?.get("q")).toBe("netflix"));
  });

  it("persists what is applied and forgets it after clearing", async () => {
    const { result } = renderHook(() => useExpenseFilters(), {
      wrapper: makeWrapper("/?q=netflix"),
    });

    await waitFor(() => expect(readStoredFilters()?.get("q")).toBe("netflix"));

    act(() => result.current.clearFilters());

    await waitFor(() => expect(readStoredFilters()).toBeNull());
  });

  it("never persists the transient suggestions flag", () => {
    persistFilters(new URLSearchParams("category_suggestions=1&q=netflix"));

    expect(sessionStorage.getItem(EXPENSES_FILTERS_KEY)).toBe("q=netflix");
  });
});
