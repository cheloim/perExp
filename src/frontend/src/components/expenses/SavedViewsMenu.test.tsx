import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SavedViewsMenu } from "./SavedViewsMenu";
import { SAVED_VIEWS_KEY } from "../../utils/savedViews";

beforeEach(() => localStorage.clear());

function renderMenu(search = "range=3m", onApply = vi.fn()) {
  render(<SavedViewsMenu searchParams={new URLSearchParams(search)} onApply={onApply} />);
  fireEvent.click(screen.getByRole("button", { name: "Vistas guardadas" }));
  return { onApply };
}

describe("SavedViewsMenu", () => {
  it("saves the current filter set under a name", () => {
    renderMenu();

    fireEvent.change(screen.getByLabelText("Nombre de la vista"), {
      target: { value: "Trimestre" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByRole("button", { name: "Trimestre" })).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)!) as {
      name: string;
      params: string;
    }[];
    expect(stored[0]).toMatchObject({ name: "Trimestre", params: "range=3m" });
  });

  it("applies a saved view", () => {
    localStorage.setItem(
      SAVED_VIEWS_KEY,
      JSON.stringify([{ id: "1", name: "Trimestre", params: "range=3m", createdAt: 1 }]),
    );
    const { onApply } = renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Trimestre" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0] as URLSearchParams;
    expect(applied.get("range")).toBe("3m");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deletes a saved view", () => {
    localStorage.setItem(
      SAVED_VIEWS_KEY,
      JSON.stringify([{ id: "1", name: "Trimestre", params: "range=3m", createdAt: 1 }]),
    );
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar vista Trimestre" }));

    expect(screen.queryByRole("button", { name: "Trimestre" })).toBeNull();
    expect(JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)!)).toEqual([]);
  });

  it("does not offer to save an empty filter set", () => {
    renderMenu("");

    expect(screen.getByLabelText("Nombre de la vista")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(screen.getByText("Aplicá algún filtro antes de guardar.")).toBeInTheDocument();
  });

  it("closes on Escape without applying anything", () => {
    const { onApply } = renderMenu();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });
});
