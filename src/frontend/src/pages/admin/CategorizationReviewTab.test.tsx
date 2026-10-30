import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CategorizationReviewTab from "./CategorizationReviewTab";
import type {
  CategorizationReview,
  CategorizationReviewDetail,
  CategorizationReviewsResponse,
  ReviewsSummary,
} from "../../types";

const h = vi.hoisted(() => ({
  getReviews: vi.fn(),
  getReview: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  investigate: vi.fn(),
  bulk: vi.fn(),
  scan: vi.fn(),
  getUsers: vi.fn(),
  getTasks: vi.fn(),
  toast: vi.fn(),
  downloadCsv: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  getCategorizationReviews: h.getReviews,
  getCategorizationReview: h.getReview,
  acceptCategorizationReview: h.accept,
  rejectCategorizationReview: h.reject,
  investigateCategorizationReview: h.investigate,
  bulkAcceptCategorizationReviews: h.bulk,
  scanCategorizationReviews: h.scan,
  getAdminUsers: h.getUsers,
  getTaskStatus: h.getTasks,
}));

vi.mock("../../utils/toast", () => ({ showToast: h.toast }));
vi.mock("../../utils/csv", () => ({ downloadCsv: h.downloadCsv }));

function makeReview(overrides: Partial<CategorizationReview> = {}): CategorizationReview {
  return {
    id: 1,
    expense_id: 33,
    user_id: 7,
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
    ...overrides,
  };
}

function makeDetail(
  overrides: Partial<CategorizationReviewDetail> = {},
): CategorizationReviewDetail {
  return {
    ...makeReview(),
    evidence: {
      merchant_key: "yenny tortugas open mall",
      current_category: { id: 1, name: "Electricidad & Gas", keywords: "edenor,edesur" },
      signals: { category_keyword_miss: { weight: 0.55 } },
    },
    available_categories: [
      { id: 17, name: "Librería", color: "#333", keywords: "" },
      { id: 2, name: "Accesorios", color: "#222", keywords: "" },
    ],
    ...overrides,
  };
}

function makeResponse(
  items: CategorizationReview[],
  summaryOverrides: Partial<ReviewsSummary> = {},
): CategorizationReviewsResponse {
  const byStatus: Record<string, number> = {};
  for (const item of items) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
  return {
    items,
    total: items.length,
    page: 1,
    per_page: 50,
    summary: {
      total: items.length,
      by_status: byStatus,
      by_signal: { category_keyword_miss: 1, history_conflict: 1 },
      by_source: { "rules+llm": 1 },
      observed_precision: 0.8,
      manual_precision: 0.82,
      bulk_accepted: 0,
      ...summaryOverrides,
    },
  };
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CategorizationReviewTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getReviews.mockResolvedValue(makeResponse([makeReview()]));
  h.getReview.mockResolvedValue(makeDetail());
  h.accept.mockResolvedValue(makeDetail());
  h.reject.mockResolvedValue(makeDetail({ status: "rejected" }));
  h.investigate.mockResolvedValue(makeDetail({ status: "investigated" }));
  h.bulk.mockResolvedValue({
    candidates: 2,
    accepted: 2,
    skipped_without_suggestion: 0,
    skipped_stale: 0,
    skipped_missing_category: 0,
    dry_run: false,
    max_items: 50,
    min_score: 0.8,
  });
  h.scan.mockResolvedValue({ scanned: 10, candidates: 2, persisted: 2, users: 1, runs: [] });
  h.getUsers.mockResolvedValue({
    users: [{ id: 7, full_name: "Chelo", email: "chelo@example.com" }],
    total: 1,
  });
  h.getTasks.mockResolvedValue({
    tasks: [
      {
        name: "categorization-review-scan-daily",
        last_run: "2026-10-28 04:30",
        last_status: "success",
      },
    ],
  });
});

describe("CategorizationReviewTab", () => {
  it("muestra el resumen, la precisión manual y la última corrida del job", async () => {
    renderTab();

    await screen.findByText("YENNY TORTUGAS OPEN MALL");
    expect(screen.getByText("0.82")).toBeInTheDocument();
    expect(screen.getByText(/2026-10-28 04:30/)).toBeInTheDocument();
    expect(screen.getByText(/Un escaneo manual no actualiza esta fecha/)).toBeInTheDocument();
  });

  it("muestra los conteos por señal sin confundirlos con el total", async () => {
    renderTab();

    await screen.findByText("YENNY TORTUGAS OPEN MALL");
    expect(screen.getByText("Keyword miss: 1")).toBeInTheDocument();
    expect(screen.getByText("Historial del comercio: 1")).toBeInTheDocument();
  });

  it("pasa los filtros como params y no dispara un escaneo", async () => {
    renderTab();
    await screen.findByText("YENNY TORTUGAS OPEN MALL");

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Score máximo"), { target: { value: "0.9" } });
    fireEvent.change(screen.getByLabelText("Filtrar por señal"), {
      target: { value: "history_conflict" },
    });
    fireEvent.change(screen.getByLabelText("Filtrar por usuario"), { target: { value: "7" } });

    await waitFor(() =>
      expect(h.getReviews).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "all",
          max_score: 0.9,
          signal: "history_conflict",
          user_id: 7,
          page: 1,
          per_page: 50,
        }),
      ),
    );
    expect(h.scan).not.toHaveBeenCalled();
  });

  it("la búsqueda por comercio viaja como search y vuelve a la página 1", async () => {
    renderTab();
    await screen.findByText("YENNY TORTUGAS OPEN MALL");

    fireEvent.change(screen.getByLabelText("Buscar comercio"), {
      target: { value: "farmacia" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() =>
      expect(h.getReviews).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "farmacia", page: 1 }),
      ),
    );
  });

  it("aceptar llama al endpoint y refresca la lista", async () => {
    renderTab();
    await screen.findByText("YENNY TORTUGAS OPEN MALL");
    const callsBefore = h.getReviews.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Aceptar YENNY TORTUGAS OPEN MALL" }));

    await waitFor(() => expect(h.accept).toHaveBeenCalledWith(1, undefined));
    await waitFor(() => expect(h.getReviews.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("aceptar sin categoría sugerida abre el selector y aplica la elegida", async () => {
    h.getReviews.mockResolvedValue(
      makeResponse([makeReview({ suggested_category_id: null, suggested_category_name: null })]),
    );
    h.getReview.mockResolvedValue(
      makeDetail({ suggested_category_id: null, suggested_category_name: null }),
    );
    renderTab();
    await screen.findByText("YENNY TORTUGAS OPEN MALL");

    fireEvent.click(screen.getByRole("button", { name: "Aceptar YENNY TORTUGAS OPEN MALL" }));

    const select = await screen.findByLabelText("Categoría de destino");
    fireEvent.change(select, { target: { value: "17" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar categoría" }));

    await waitFor(() => expect(h.accept).toHaveBeenCalledWith(1, 17));
  });

  it("rechazar pide confirmación antes de llamar al endpoint", async () => {
    renderTab();
    await screen.findByText("YENNY TORTUGAS OPEN MALL");

    fireEvent.click(screen.getByRole("button", { name: "Rechazar YENNY TORTUGAS OPEN MALL" }));
    expect(h.reject).not.toHaveBeenCalled();
    expect(screen.getByText(/Se marca como falso positivo/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    await waitFor(() => expect(h.reject).toHaveBeenCalledWith(1));
  });

  it("un 409 avisa que la revisión quedó obsoleta y refresca", async () => {
    h.accept.mockRejectedValue({ response: { status: 409, data: { detail: "stale" } } });
    renderTab();
    await screen.findByText("YENNY TORTUGAS OPEN MALL");
    const callsBefore = h.getReviews.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Aceptar YENNY TORTUGAS OPEN MALL" }));

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining("obsoleta"), "error"),
    );
    await waitFor(() => expect(h.getReviews.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("muestra el estado vacío con la pista de la flag", async () => {
    h.getReviews.mockResolvedValue(
      makeResponse([], { total: 0, by_status: {}, by_signal: {}, manual_precision: null }),
    );
    renderTab();

    expect(await screen.findByText("No hay revisiones para estos filtros")).toBeInTheDocument();
    expect(screen.getByText(/categorization_review_enabled/)).toBeInTheDocument();
  });

  it("el escaneo manual manda solo el usuario, nunca since", async () => {
    renderTab();
    await screen.findByText("YENNY TORTUGAS OPEN MALL");

    fireEvent.change(screen.getByLabelText("Usuario a escanear"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Escanear ahora" }));

    await waitFor(() => expect(h.scan).toHaveBeenCalledTimes(1));
    expect(h.scan).toHaveBeenCalledWith({ user_id: 7, use_llm: true });
    expect(h.scan.mock.calls[0][0]).not.toHaveProperty("since");
  });

  it("la aceptación masiva pide confirmación y respeta el umbral", async () => {
    renderTab();
    await screen.findByText("YENNY TORTUGAS OPEN MALL");

    fireEvent.change(screen.getByLabelText("Umbral de aceptación masiva"), {
      target: { value: "0.9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aceptar ≥ umbral" }));
    expect(screen.getByText(/score ≥ 0.9/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));

    await waitFor(() => expect(h.bulk).toHaveBeenCalledTimes(1));
    expect(h.bulk.mock.calls[0][0]).toEqual(expect.objectContaining({ min_score: 0.9 }));
    await waitFor(() => expect(h.toast).toHaveBeenCalled());
  });

  it("exporta el CSV con los filtros activos", async () => {
    renderTab();
    await screen.findByText("YENNY TORTUGAS OPEN MALL");

    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));

    await waitFor(() => expect(h.downloadCsv).toHaveBeenCalledTimes(1));
    const [filename, headers, rows] = h.downloadCsv.mock.calls[0];
    expect(filename).toMatch(/^categorization-reviews-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(headers).not.toContain("senales");
    expect(rows[0][1]).toBe("YENNY TORTUGAS OPEN MALL");
  });
});
