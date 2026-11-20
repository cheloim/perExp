import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyTotals } from "./money";

describe("formatMoney", () => {
  it("formats pesos with the local symbol and separators", () => {
    expect(formatMoney(30000, "ARS")).toBe("$ 30.000,00");
    expect(formatMoney(1234.5, "ARS")).toBe("$ 1.234,50");
  });

  it("formats dollars with U$S so they cannot be read as pesos", () => {
    expect(formatMoney(7, "USD")).toBe("U$S 7,00");
    expect(formatMoney(1234.5, "USD")).toBe("U$S 1.234,50");
  });

  it("keeps the sign in front of the currency prefix", () => {
    expect(formatMoney(-500, "ARS")).toBe("-$ 500,00");
    expect(formatMoney(-7, "USD")).toBe("-U$S 7,00");
  });

  it("formats zero", () => {
    expect(formatMoney(0, "ARS")).toBe("$ 0,00");
  });

  it("treats a missing currency as pesos", () => {
    expect(formatMoney(1500, null)).toBe("$ 1.500,00");
    expect(formatMoney(1500, undefined)).toBe("$ 1.500,00");
  });

  it("normalizes the currency code", () => {
    expect(formatMoney(7, "usd")).toBe("U$S 7,00");
  });
});

describe("formatMoneyTotals", () => {
  it("shows each currency separately, pesos first", () => {
    expect(
      formatMoneyTotals([
        { amount: 7, currency: "USD" },
        { amount: 30000, currency: "ARS" },
      ]),
    ).toBe("$ 30.000,00 + U$S 7,00");
  });

  it("does not invent a second currency", () => {
    expect(formatMoneyTotals([{ amount: 7, currency: "USD" }])).toBe("U$S 7,00");
    expect(formatMoneyTotals([{ amount: 30000, currency: "ARS" }])).toBe("$ 30.000,00");
  });

  it("defaults missing currencies to pesos", () => {
    expect(formatMoneyTotals([{ amount: 1500 }])).toBe("$ 1.500,00");
  });

  it("formats an empty list as zero pesos", () => {
    expect(formatMoneyTotals([])).toBe("$ 0,00");
  });
});
