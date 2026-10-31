import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateRangePicker } from "./DateRangePicker";

function renderPicker(overrides: Partial<React.ComponentProps<typeof DateRangePicker>> = {}) {
  const onChange = vi.fn();
  const utils = render(<DateRangePicker onChange={onChange} {...overrides} />);
  return { ...utils, onChange };
}

describe("DateRangePicker", () => {
  it("shows the placeholder when there is no range", () => {
    renderPicker();

    expect(screen.getByRole("button", { name: "Fecha" })).toBeInTheDocument();
  });

  it("labels a preset in plain Spanish", () => {
    renderPicker({ preset: "3m" });

    expect(screen.getByRole("button", { name: "Últimos 3 meses" })).toBeInTheDocument();
  });

  it("labels a custom range with both dates", () => {
    renderPicker({ from: "2026-09-01", to: "2026-09-15" });

    expect(screen.getByRole("button", { name: "01-09-2026 – 15-09-2026" })).toBeInTheDocument();
  });

  it("labels the legacy month link", () => {
    renderPicker({ month: "2026-10" });

    expect(screen.getByRole("button", { name: /octubre de 2026/i })).toBeInTheDocument();
  });

  it("applies a preset in one click", () => {
    const { onChange } = renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Fecha" }));
    fireEvent.click(screen.getByRole("button", { name: "3m" }));

    expect(onChange).toHaveBeenLastCalledWith({ preset: "3m" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("applies the custom calendar range", () => {
    const { onChange } = renderPicker({ from: "2026-09-01", to: "2026-09-15" });

    fireEvent.click(screen.getByRole("button", { name: "01-09-2026 – 15-09-2026" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-09-01", to: "2026-09-15" });
  });

  it("clears every date filter", () => {
    const { onChange } = renderPicker({ preset: "6m" });

    fireEvent.click(screen.getByRole("button", { name: "Últimos 6 meses" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("closes on Escape without applying anything", () => {
    const { onChange } = renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Fecha" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
