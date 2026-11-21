import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import Dialog from "./Dialog";

function Harness() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <Dialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Editar gasto"
        description="Ajustá los datos del movimiento."
        footer={
          <button type="button" onClick={() => setOpen(false)}>
            Guardar
          </button>
        }
      >
        <input aria-label="Comercio" />
      </Dialog>
    </div>
  );
}

describe("Dialog", () => {
  it("exposes a modal dialog named by its title", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));

    const dialog = screen.getByRole("dialog", { name: "Editar gasto" });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Ajustá los datos del movimiento.");
  });

  it("moves focus inside the dialog when it opens", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes with Escape and returns focus to the trigger", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Abrir" });

    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("marks the background inert while open", () => {
    const { container } = render(<Harness />);

    expect(container).not.toHaveAttribute("inert");

    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(container).toHaveAttribute("inert");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(container).not.toHaveAttribute("inert");
  });
});
