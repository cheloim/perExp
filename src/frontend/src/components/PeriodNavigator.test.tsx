import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PeriodNavigator from "./PeriodNavigator";

describe("PeriodNavigator", () => {
  it("shows the month and offers all-history as a distinct state", async () => {
    const onChange = vi.fn();
    render(<PeriodNavigator period="2026-11" onChange={onChange} />);

    expect(screen.getByText("Noviembre 2026")).toBeVisible();
    const allHistory = screen.getByRole("button", { name: "Todo el historial" });
    expect(allHistory).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(allHistory);
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("labels all-history and leaves it for the last concrete month", async () => {
    const onChange = vi.fn();
    render(<PeriodNavigator period="all" anchorMonth="2026-03" onChange={onChange} />);

    expect(screen.getByText("Todo el historial")).toBeVisible();
    expect(screen.getByRole("button", { name: "Todo el historial" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(onChange).toHaveBeenCalledWith("2026-02");
  });
});
