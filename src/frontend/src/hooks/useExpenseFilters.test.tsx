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
});
