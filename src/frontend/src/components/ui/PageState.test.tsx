import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import PageState from "./PageState";

describe("PageState", () => {
  it("shows a loading skeleton above the content", () => {
    render(<PageState state="loading" skeleton={<div data-testid="skeleton" />} />);

    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton").closest("[aria-busy]")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("shows the error message and retries", () => {
    const onRetry = vi.fn();
    render(<PageState state="error" errorMessage="Falló la carga" onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Falló la carga");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the empty state with its action", () => {
    const action = vi.fn();
    render(
      <PageState
        state="empty"
        emptyTitle="Sin gastos"
        emptyDescription="Cargá el primero"
        emptyAction={{ label: "Agregar gasto", onClick: action }}
      />,
    );

    expect(screen.getByText("Sin gastos")).toBeInTheDocument();
    expect(screen.getByText("Cargá el primero")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Agregar gasto" }));

    expect(action).toHaveBeenCalledOnce();
  });

  it("renders the content on success", () => {
    const { container } = render(
      <PageState state="success">
        <p>datos reales</p>
      </PageState>,
    );

    expect(screen.getByText("datos reales")).toBeInTheDocument();
    expect(container.firstElementChild).not.toHaveAttribute("aria-busy");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
