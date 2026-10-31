import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { expenseQueryKeys, invalidateExpenseQueries } from "./expenseQueries";

describe("expense query keys", () => {
  it("keys the optimistic list exactly where the list query lives", () => {
    expect(expenseQueryKeys.list("a-b", 100)).toEqual(["expenses-list", "a-b", 100]);
    expect(expenseQueryKeys.stats("a-b")).toEqual(["expense-stats", "a-b"]);
  });

  it("invalidates the list and every derived aggregate", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    invalidateExpenseQueries(queryClient);

    expect(spy.mock.calls.map(([arg]) => arg?.queryKey)).toEqual([
      ["expenses-list"],
      ["expense-stats"],
    ]);
  });
});
