import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ReviewEvidence from "./ReviewEvidence";
import type { CategorizationReviewDetail } from "../../types";

function makeDetail(
  overrides: Partial<CategorizationReviewDetail> = {},
): CategorizationReviewDetail {
  return {
    id: 12,
    expense_id: 33,
    user_id: 3,
    date: "2026-10-13",
    description: "YENNY TORTUGAS OPEN MALL",
    amount: 55479.67,
    currency: "ARS",
    current_category_id: 1,
    current_category_name: "Electricidad & Gas",
    suggested_category_id: 2,
    suggested_category_name: "Accesorios",
    score: 0.75,
    source: "rules+llm",
    reason: "no coincide con las palabras clave",
    status: "pending",
    detector_version: "v1",
    created_at: "2026-10-24T10:00:00",
    reviewed_at: null,
    evidence: {
      merchant_key: "yenny tortugas open mall",
      current_category: {
        id: 1,
        name: "Electricidad & Gas",
        keywords: "edenor,edesur,metrogas",
      },
      signals: {
        category_keyword_miss: { weight: 0.55, tier: 2, coverage: 0.8 },
        history_conflict: { weight: 0.4, support: 6, share: 0.9 },
      },
      llm: {
        is_mismatch: true,
        confidence: 0.82,
        suggested_category_id: 2,
        reason: "es una librería",
      },
    },
    available_categories: [
      { id: 1, name: "Electricidad & Gas", color: "#111", keywords: "" },
      { id: 2, name: "Accesorios", color: "#222", keywords: "" },
    ],
    ...overrides,
  };
}

describe("ReviewEvidence", () => {
  it("muestra las keywords de la categoría actual y la clave de comercio", () => {
    render(<ReviewEvidence review={makeDetail()} onAcceptWithCategory={vi.fn()} />);

    expect(screen.getByText(/edenor,edesur,metrogas/)).toBeInTheDocument();
    expect(screen.getByText("yenny tortugas open mall")).toBeInTheDocument();
  });

  it("muestra cada señal con su peso", () => {
    render(<ReviewEvidence review={makeDetail()} onAcceptWithCategory={vi.fn()} />);

    expect(screen.getByText("El comercio no coincide con su categoría")).toBeInTheDocument();
    expect(screen.getByText("Historial del comercio")).toBeInTheDocument();
    expect(screen.getByText("(peso 0.55)")).toBeInTheDocument();
    expect(screen.getByText("(peso 0.4)")).toBeInTheDocument();
    expect(screen.getByLabelText("Señales del detector").children).toHaveLength(2);
  });

  it("muestra el veredicto del LLM con su confianza", () => {
    render(<ReviewEvidence review={makeDetail()} onAcceptWithCategory={vi.fn()} />);

    expect(screen.getByText(/Confirma el desvío/)).toBeInTheDocument();
    expect(screen.getByText(/0\.82/)).toBeInTheDocument();
    expect(screen.getByText(/es una librería/)).toBeInTheDocument();
  });

  it("con rules-only avisa que no hay segunda opinión", () => {
    const noLlm = makeDetail();
    delete noLlm.evidence.llm;

    render(<ReviewEvidence review={noLlm} onAcceptWithCategory={vi.fn()} />);

    expect(screen.getByText(/Sin segunda opinión/)).toBeInTheDocument();
  });

  it("muestra el selector solo cuando no hay categoría sugerida", () => {
    const { rerender } = render(
      <ReviewEvidence review={makeDetail()} onAcceptWithCategory={vi.fn()} />,
    );
    expect(screen.queryByLabelText("Categoría de destino")).not.toBeInTheDocument();

    rerender(
      <ReviewEvidence
        review={makeDetail({ suggested_category_id: null, suggested_category_name: null })}
        onAcceptWithCategory={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Categoría de destino")).toBeInTheDocument();
  });

  it("al elegir una categoría la aplica con su id", () => {
    const onAcceptWithCategory = vi.fn();
    render(
      <ReviewEvidence
        review={makeDetail({ suggested_category_id: null, suggested_category_name: null })}
        onAcceptWithCategory={onAcceptWithCategory}
      />,
    );

    fireEvent.change(screen.getByLabelText("Categoría de destino"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar categoría" }));

    expect(onAcceptWithCategory).toHaveBeenCalledWith(2);
  });

  it("con evidencia vacía muestra el fallback", () => {
    render(<ReviewEvidence review={makeDetail({ evidence: {} })} onAcceptWithCategory={vi.fn()} />);

    expect(screen.getByText("Sin evidencia registrada.")).toBeInTheDocument();
  });
});
