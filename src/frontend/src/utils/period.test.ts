import { describe, it, expect, beforeEach } from "vitest";
import {
  PERIOD_MONTH_STORAGE_KEY,
  currentMonth,
  formatMonth,
  isMonth,
  parseMonth,
  persistMonth,
  readStoredMonth,
  shiftMonth,
} from "./period";

beforeEach(() => {
  sessionStorage.clear();
});

describe("period helpers", () => {
  it("formats the current month as YYYY-MM", () => {
    expect(currentMonth(new Date(2026, 0, 15))).toBe("2026-01");
    expect(currentMonth(new Date(2026, 11, 1))).toBe("2026-12");
  });

  it("accepts only real YYYY-MM values", () => {
    expect(isMonth("2026-11")).toBe(true);
    expect(parseMonth("2026-11")).toBe("2026-11");
    expect(parseMonth("2026-13")).toBeUndefined();
    expect(parseMonth("2026-00")).toBeUndefined();
    expect(parseMonth("2026-1")).toBeUndefined();
    expect(parseMonth("noviembre")).toBeUndefined();
    expect(parseMonth(null)).toBeUndefined();
  });

  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-11", -2)).toBe("2026-09");
  });

  it("renders a human label in Spanish", () => {
    expect(formatMonth("2026-11")).toBe("Noviembre 2026");
    expect(formatMonth("2026-01")).toBe("Enero 2026");
  });

  it("restores the stored month and ignores junk", () => {
    persistMonth("2026-10");
    expect(sessionStorage.getItem(PERIOD_MONTH_STORAGE_KEY)).toBe("2026-10");
    expect(readStoredMonth()).toBe("2026-10");

    sessionStorage.setItem(PERIOD_MONTH_STORAGE_KEY, "not-a-month");
    expect(readStoredMonth()).toBeUndefined();

    persistMonth("junk");
    expect(sessionStorage.getItem(PERIOD_MONTH_STORAGE_KEY)).toBe("not-a-month");
  });
});
