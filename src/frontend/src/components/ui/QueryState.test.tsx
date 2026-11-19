import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import QueryState from "./QueryState";

describe("QueryState", () => {
  it("shows a skeleton while the first payload is loading", () => {
    render(
      <QueryState isLoading hasData={false} skeleton={<div data-testid="skeleton" />}>
        <p>contenido</p>
      </QueryState>,
    );

    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByText("contenido")).not.toBeInTheDocument();
    expect(screen.queryByText("$ 0")).not.toBeInTheDocument();
  });

  it("shows a retry action when the query fails without data", () => {
    const onRetry = vi.fn();
    render(
      <QueryState isError hasData={false} onRetry={onRetry}>
        <p>contenido</p>
      </QueryState>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText("contenido")).not.toBeInTheDocument();
  });

  it("keeps the previous data and offers retry after a refetch error", () => {
    const onRetry = vi.fn();
    render(
      <QueryState isError hasData onRetry={onRetry}>
        <p>datos previos</p>
      </QueryState>,
    );

    expect(screen.getByText("datos previos")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos actualizar");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("distinguishes an empty result from loading and error", () => {
    render(
      <QueryState isEmpty emptyTitle="Sin gastos" emptyDescription="Cargá el primero">
        <p>contenido</p>
      </QueryState>,
    );

    expect(screen.getByText("Sin gastos")).toBeInTheDocument();
    expect(screen.getByText("Cargá el primero")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
