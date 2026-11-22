import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Field from "./Field";
import { Select } from "./Select";

describe("Select inside Field", () => {
  it("exposes the Field label and the error wiring on its trigger", () => {
    render(
      <Field label="Grupo" error="Elegí un grupo" id="budget-group">
        <Select id="budget-group" value="" onChange={() => {}} options={[]} />
      </Field>,
    );

    const trigger = screen.getByRole("button", { name: "Grupo" });
    expect(trigger).toHaveAttribute("id", "budget-group");
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAttribute("aria-describedby", "budget-group-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Elegí un grupo");
  });

  it("keeps the descriptive aria-label when there is no visible label", () => {
    render(<Select value="" onChange={() => {}} ariaLabel="Moneda" />);

    expect(screen.getByRole("button", { name: /Moneda/ })).toBeInTheDocument();
  });
});
