import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import Money, { MoneyTotals } from "./Money";

describe("Money", () => {
  it("renders pesos with the Argentine notation", () => {
    render(<Money amount={1234.5} />);

    expect(screen.getByText("$ 1.234,50")).toBeInTheDocument();
  });

  it("renders dollars with the U$S prefix", () => {
    render(<Money amount={7} currency="USD" />);

    expect(screen.getByText("U$S 7,00")).toBeInTheDocument();
  });

  it("keeps the minus sign for negative amounts", () => {
    render(<Money amount={-123} />);

    expect(screen.getByText("-$ 123,00")).toBeInTheDocument();
  });

  it("never adds different currencies together", () => {
    render(
      <MoneyTotals
        items={[
          { amount: 30000, currency: "ARS" },
          { amount: 7, currency: "USD" },
        ]}
      />,
    );

    expect(screen.getByText("$ 30.000,00 + U$S 7,00")).toBeInTheDocument();
  });
});
