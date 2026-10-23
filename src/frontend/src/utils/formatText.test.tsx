import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatAIResponse } from "./formatText";

function renderReply(markdown: string) {
  return render(<div>{formatAIResponse(markdown)}</div>);
}

describe("formatAIResponse", () => {
  it("renderiza una tabla markdown como <table> real, con encabezado y filas", () => {
    const { container } = renderReply(
      [
        "Gastos del mes",
        "",
        "| Concepto | Monto |",
        "| --- | --- |",
        "| Supermercado | $12.500 |",
        "| Transporte | $3.200 |",
      ].join("\n"),
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    // Header cells and one body row per data line.
    expect(table!.querySelectorAll("th")).toHaveLength(2);
    expect(table!.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByText("Supermercado")).toBeInTheDocument();
  });

  it("un monto conserva su clase de color y su mono", () => {
    renderReply("Este mes gastaste US$ 1.250,50 en supermercado.");

    const amount = screen.getByText("US$ 1.250,50");
    expect(amount.className).toContain("font-mono");
    expect(amount.className).toContain("text-[var(--color-primary)]");
  });

  it("un porcentaje negativo va en rojo y uno positivo en verde", () => {
    renderReply(["La inflación fue de -3,2% y el ahorro subió +4,5%."].join("\n"));

    const negative = screen.getByText("-3,2%");
    expect(negative.className).toContain("text-[var(--gnome-red-3)]");

    const positive = screen.getByText("+4,5%");
    expect(positive.className).toContain("text-[var(--gnome-green-5)]");
  });

  it("una lista anidada se renderiza como lista anidada", () => {
    const { container } = renderReply(
      ["- Gastos fijos", "  - Alquiler", "  - Servicios", "- Variables"].join("\n"),
    );

    const nested = container.querySelectorAll("ul ul");
    expect(nested).toHaveLength(1);
    expect(nested[0].querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("Alquiler")).toBeInTheDocument();
  });

  it("un bloque de código se renderiza como <code> (e inline también)", () => {
    const { container } = renderReply(
      ["Corré `npm test` antes de pushear.", "", "```", "const total = 1;", "```"].join("\n"),
    );

    const block = container.querySelector("pre code");
    expect(block).not.toBeNull();
    expect(block!.textContent).toContain("const total = 1;");

    const inline = screen.getByText("npm test");
    expect(inline.tagName).toBe("CODE");
  });

  it("markdown malformado no rompe el render", () => {
    const { container } = renderReply(
      [
        "**negrita sin cerrar",
        "| col1 | col2",
        "> cita sin cerrar",
        "[link roto](",
        "### heading sin nada",
        "*cursiva sin cerrar",
        "| --- | --- |",
      ].join("\n"),
    );

    // It renders *something* readable and never throws on the way there.
    expect(container.textContent).toContain("negrita sin cerrar");
  });

  it("links, negritas y blockquotes se renderizan como estructura real", () => {
    const { container } = renderReply(
      ["Mirá [la guía](https://ejemplo.com/ayuda) para más.", "", "> **Importante:** revisá el mes."].join(
        "\n",
      ),
    );

    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", "https://ejemplo.com/ayuda");
    expect(container.querySelector("strong")!.textContent).toBe("Importante:");
    expect(container.querySelector("blockquote")).not.toBeNull();
  });

  it("conserva la colorización por emoji de tendencia al inicio de la línea", () => {
    const { container } = renderReply(
      ["📈 Subió mucho el supermercado", "", "⚠ Alerta de gastos", "", "↓ Cayó el transporte"].join(
        "\n",
      ),
    );

    const [up, warn, down] = container.querySelectorAll("p");
    expect(up.className).toContain("text-[var(--gnome-green-5)]");
    expect(warn.className).toContain("text-[var(--gnome-yellow-4)]");
    expect(down.className).toContain("text-[var(--gnome-red-3)]");
  });
});
