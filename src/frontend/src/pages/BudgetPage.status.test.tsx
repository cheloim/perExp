import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetStatusBadge, budgetStatusForPct, budgetStatusFromBackend } from "./BudgetPage";

describe("budget status", () => {
  it("gives every band a text label and an icon, never colour alone", () => {
    const statuses = [100, 95, 85, 65, 10].map(budgetStatusForPct);

    expect(new Set(statuses.map((status) => status.label)).size).toBe(5);
    expect(new Set(statuses.map((status) => status.icon)).size).toBe(5);
    for (const status of statuses) {
      expect(status.label.trim()).not.toBe("");
      expect(status.icon).toBeTruthy();
    }
  });

  it("renders the label as text next to the icon", () => {
    const { container } = render(<BudgetStatusBadge pct={100} />);

    expect(screen.getByText("Excedido")).toBeInTheDocument();
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("maps backend statuses to a label and icon too", () => {
    for (const status of ["exceeded", "warning", "ok", "no_budget"]) {
      const meta = budgetStatusFromBackend(status);
      expect(meta.label.trim()).not.toBe("");
      expect(meta.icon).toBeTruthy();
    }
  });
});
