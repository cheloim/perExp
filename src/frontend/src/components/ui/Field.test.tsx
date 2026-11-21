import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import Field from "./Field";

describe("Field", () => {
  it("associates the visible label with the control", () => {
    render(
      <Field label="Monto">
        <input />
      </Field>,
    );

    const input = screen.getByLabelText("Monto");

    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("id");
  });

  it("links help and error text and marks the control invalid", () => {
    render(
      <Field label="Monto" help="En pesos argentinos" error="Ingresá un monto válido">
        <input />
      </Field>,
    );

    const input = screen.getByLabelText("Monto");
    const describedBy = input.getAttribute("aria-describedby");

    expect(describedBy).toContain(`${input.id}-help`);
    expect(describedBy).toContain(`${input.id}-error`);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-errormessage", `${input.id}-error`);
    expect(screen.getByText("En pesos argentinos")).toHaveAttribute("id", `${input.id}-help`);
    expect(screen.getByRole("alert")).toHaveTextContent("Ingresá un monto válido");
  });

  it("keeps an explicit id and any existing describedby", () => {
    render(
      <Field label="Categoría" help="Elegí una">
        <input id="categoria" aria-describedby="ayuda-externa" />
      </Field>,
    );

    const input = screen.getByLabelText("Categoría");
    const describedBy = input.getAttribute("aria-describedby");

    expect(input).toHaveAttribute("id", "categoria");
    expect(describedBy).toContain("ayuda-externa");
    expect(describedBy).toContain("categoria-help");
  });

  it("marks the control as required", () => {
    render(
      <Field label="Monto" required>
        <input />
      </Field>,
    );

    expect(screen.getByRole("textbox", { name: "Monto" })).toBeRequired();
  });
});
