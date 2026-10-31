import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MultiSelect } from "./MultiSelect";

const GROUPS = [
  {
    label: "Comida",
    options: [
      { value: "3", label: "Supermercado" },
      { value: "4", label: "Restaurantes" },
    ],
  },
  {
    label: "Transporte",
    options: [{ value: "7", label: "Nafta" }],
  },
];

function renderMultiSelect(overrides: Partial<React.ComponentProps<typeof MultiSelect>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <MultiSelect
      values={[]}
      onChange={onChange}
      groups={GROUPS}
      placeholder="Categoría"
      {...overrides}
    />,
  );
  return { ...utils, onChange };
}

describe("MultiSelect", () => {
  it("names the trigger with the placeholder while nothing is selected", () => {
    renderMultiSelect();

    expect(screen.getByRole("button", { name: "Categoría" })).toBeInTheDocument();
  });

  it("names the trigger with the single selected category", () => {
    renderMultiSelect({ values: ["3"] });

    expect(screen.getByRole("button", { name: "Supermercado" })).toBeInTheDocument();
  });

  it("counts the selection once more than one category is chosen", () => {
    renderMultiSelect({ values: ["3", "7"] });

    expect(screen.getByRole("button", { name: "2 categorías" })).toBeInTheDocument();
  });

  it("toggles a category without closing the list", () => {
    const { onChange } = renderMultiSelect();

    fireEvent.click(screen.getByRole("button", { name: "Categoría" }));
    const list = screen.getByRole("listbox");
    fireEvent.click(within(list).getByRole("option", { name: "Supermercado" }));

    expect(onChange).toHaveBeenLastCalledWith(["3"]);
    // Still open: a multi-select is for picking several in a row.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("removes a category that was already selected", () => {
    const { onChange } = renderMultiSelect({ values: ["3"] });

    fireEvent.click(screen.getByRole("button", { name: "Supermercado" }));
    const list = screen.getByRole("listbox");
    expect(within(list).getByRole("option", { name: "Supermercado" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(within(list).getByRole("option", { name: "Supermercado" }));

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("filters the list with the search box", () => {
    renderMultiSelect();

    fireEvent.click(screen.getByRole("button", { name: "Categoría" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar categorías" }), {
      target: { value: "nafta" },
    });

    const list = screen.getByRole("listbox");
    expect(within(list).getByRole("option", { name: "Nafta" })).toBeInTheDocument();
    expect(within(list).queryByRole("option", { name: "Supermercado" })).toBeNull();
  });

  it("closes on Escape", () => {
    renderMultiSelect();

    fireEvent.click(screen.getByRole("button", { name: "Categoría" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Buscar categorías" }), {
      key: "Escape",
    });

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("toggles the highlighted option with the keyboard", () => {
    const { onChange } = renderMultiSelect();
    const search = () => screen.getByRole("textbox", { name: "Buscar categorías" });

    fireEvent.click(screen.getByRole("button", { name: "Categoría" }));
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "Enter" });

    // Second item: Restaurantes.
    expect(onChange).toHaveBeenLastCalledWith(["4"]);
  });

  it("clears the whole selection from the footer", () => {
    const { onChange } = renderMultiSelect({ values: ["3", "7"] });

    fireEvent.click(screen.getByRole("button", { name: "2 categorías" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar selección" }));

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("keeps the list closed while disabled", () => {
    renderMultiSelect({ disabled: true });

    fireEvent.click(screen.getByRole("button", { name: "Categoría" }));

    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
