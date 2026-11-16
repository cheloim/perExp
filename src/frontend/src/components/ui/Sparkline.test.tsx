import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Sparkline from "./Sparkline";

describe("Sparkline", () => {
  it("expone una alternativa textual cuando recibe label", () => {
    render(<Sparkline data={[1, 2, 3]} label="Tendencia de Comida: de $1 a $3" />);

    expect(
      screen.getByRole("img", { name: "Tendencia de Comida: de $1 a $3" }),
    ).toBeInTheDocument();
  });

  it("queda oculto para lectores si es decorativo", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);

    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
