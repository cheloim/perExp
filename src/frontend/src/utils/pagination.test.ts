import { describe, it, expect } from "vitest";
import { hasMorePages, paginationLabel } from "./pagination";

describe("pagination helpers", () => {
  it("says how many of the filtered total are shown", () => {
    expect(paginationLabel(100, 480)).toBe("Mostrando 100 de 480 gastos");
  });

  it("falls back to the loaded count when the total is unknown", () => {
    expect(paginationLabel(3)).toBe("3 gastos");
    expect(paginationLabel(1)).toBe("1 gasto");
  });

  it("does not say 'de' when everything fits", () => {
    expect(paginationLabel(3, 3)).toBe("3 gastos");
  });

  it("offers more pages while the total is larger than the shown rows", () => {
    expect(hasMorePages(100, 480, 100)).toBe(true);
    expect(hasMorePages(480, 480, 100)).toBe(false);
  });

  it("falls back to the limit heuristic when the total is unknown", () => {
    expect(hasMorePages(100, undefined, 100)).toBe(true);
    expect(hasMorePages(42, undefined, 100)).toBe(false);
  });
});
