import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { useExpenseFilters } from "./useExpenseFilters";

const makeWrapper = (initial: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  };

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
});
