import { describe, it, expect } from "vitest";
import { monthRange, parseDateRangePreset, presetLabel, presetRange, toISODate } from "./dateRange";

describe("date ranges", () => {
  it("1m is the current calendar month up to today", () => {
    expect(presetRange("1m", new Date(2026, 9, 15))).toEqual({
      from: "2026-10-01",
      to: "2026-10-15",
    });
  });

  it("3m starts at the first day two months back", () => {
    expect(presetRange("3m", new Date(2026, 9, 31))).toEqual({
      from: "2026-08-01",
      to: "2026-10-31",
    });
  });

  it("12m crosses the year boundary", () => {
    expect(presetRange("12m", new Date(2026, 1, 10))).toEqual({
      from: "2025-03-01",
      to: "2026-02-10",
    });
  });

  it("monthRange covers the whole month", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("monthRange rejects malformed values", () => {
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("octubre")).toBeNull();
    expect(monthRange("2026-1")).toBeNull();
  });

  it("labels presets in plain Spanish", () => {
    expect(presetLabel("1m")).toBe("Este mes");
    expect(presetLabel("2m")).toBe("Últimos 2 meses");
    expect(presetLabel("3m")).toBe("Últimos 3 meses");
    expect(presetLabel("12m")).toBe("Últimos 12 meses");
  });

  it("only accepts known presets", () => {
    expect(parseDateRangePreset("3m")).toBe("3m");
    expect(parseDateRangePreset("4m")).toBeUndefined();
    expect(parseDateRangePreset(null)).toBeUndefined();
  });

  it("formats a local date without shifting the day", () => {
    expect(toISODate(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(toISODate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
