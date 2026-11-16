import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap";

function Harness() {
  const [open, setOpen] = useState(false);
  const trapRef = useFocusTrap(open, () => setOpen(false));

  return (
    <div>
      <button onClick={() => setOpen(true)}>abrir</button>
      {open && (
        <div ref={trapRef} role="dialog" aria-modal="true">
          <button>adentro</button>
        </div>
      )}
    </div>
  );
}

describe("useFocusTrap", () => {
  it("devuelve el foco al disparador al cerrar", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "abrir" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
