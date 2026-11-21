import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { usePeriod } from "./usePeriod";
import { persistMonth } from "../utils/period";

const makeWrapper = (initial: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  };

function usePeriodHarness() {
  const period = usePeriod();
  const [params] = useSearchParams();
  return { ...period, params };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 21)); // 21 Nov 2026
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePeriod", () => {
  it("reads the month from the URL", () => {
    const { result } = renderHook(() => usePeriod(), {
      wrapper: makeWrapper("/budget?month=2026-03"),
    });

    expect(result.current.month).toBe("2026-03");
    expect(result.current.isCurrentMonth).toBe(false);
  });

  it("falls back to the current month when the URL is empty", () => {
    const { result } = renderHook(() => usePeriod(), { wrapper: makeWrapper("/") });

    expect(result.current.month).toBe("2026-11");
    expect(result.current.isCurrentMonth).toBe(true);
  });

  it("keeps the chosen month when navigating to another screen without query", () => {
    const budget = renderHook(() => usePeriod(), {
      wrapper: makeWrapper("/budget?month=2026-03"),
    });
    expect(budget.result.current.month).toBe("2026-03");
    budget.unmount();

    const expenses = renderHook(() => usePeriod(), {
      wrapper: makeWrapper("/expenses"),
    });

    expect(expenses.result.current.month).toBe("2026-03");
  });

  it("setMonth writes the URL, drops the explicit range and preserves filters", () => {
    const { result } = renderHook(() => usePeriodHarness(), {
      wrapper: makeWrapper("/expenses?range=3m&q=netflix&date_from=2026-09-01"),
    });

    act(() => result.current.setMonth("2026-10"));

    expect(result.current.month).toBe("2026-10");
    expect(result.current.params.get("month")).toBe("2026-10");
    expect(result.current.params.get("range")).toBeNull();
    expect(result.current.params.get("date_from")).toBeNull();
    expect(result.current.params.get("q")).toBe("netflix");
  });

  it("previousMonth and nextMonth move one calendar month", () => {
    const { result } = renderHook(() => usePeriod(), {
      wrapper: makeWrapper("/?month=2026-01"),
    });

    act(() => result.current.previousMonth());
    expect(result.current.month).toBe("2025-12");

    act(() => result.current.nextMonth());
    expect(result.current.month).toBe("2026-01");
  });

  it("setPeriod('all') clears month, range and dates and exposes no month", () => {
    const { result } = renderHook(() => usePeriodHarness(), {
      wrapper: makeWrapper("/expenses?month=2026-10&range=3m&date_from=2026-09-01&q=netflix"),
    });

    act(() => result.current.setPeriod("all"));

    expect(result.current.period).toBe("all");
    expect(result.current.isAllHistory).toBe(true);
    expect(result.current.month).toBeUndefined();
    expect(result.current.params.get("period")).toBe("all");
    expect(result.current.params.get("month")).toBeNull();
    expect(result.current.params.get("range")).toBeNull();
    expect(result.current.params.get("date_from")).toBeNull();
    expect(result.current.params.get("q")).toBe("netflix");
  });

  it("keeps all-history when navigating to another screen without query", () => {
    const expenses = renderHook(() => usePeriodHarness(), {
      wrapper: makeWrapper("/expenses"),
    });
    act(() => expenses.result.current.setPeriod("all"));
    expenses.unmount();

    const dashboard = renderHook(() => usePeriodHarness(), {
      wrapper: makeWrapper("/dashboard"),
    });

    expect(dashboard.result.current.period).toBe("all");
    expect(dashboard.result.current.month).toBeUndefined();
  });

  it("stepping out of all-history returns to the last concrete month", () => {
    const { result } = renderHook(() => usePeriod(), {
      wrapper: makeWrapper("/?month=2026-03"),
    });

    act(() => result.current.setPeriod("all"));
    expect(result.current.anchorMonth).toBe("2026-03");

    act(() => result.current.previousMonth());
    expect(result.current.month).toBe("2026-02");
    expect(result.current.isAllHistory).toBe(false);
  });

  it("uses the stored month when the URL arrives without one", () => {
    persistMonth("2025-08");

    const { result } = renderHook(() => usePeriod(), { wrapper: makeWrapper("/") });

    expect(result.current.month).toBe("2025-08");
  });
});
