import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { extractExpenseFromImage } from "../api/client";
import type { Expense } from "../types";
import { ExpenseModal } from "./ExpenseModals";

vi.mock("../api/client", () => ({
  getCategories: vi.fn(async () => []),
  getTags: vi.fn(async () => []),
  suggestCategory: vi.fn(async () => null),
  createCategory: vi.fn(),
  createTag: vi.fn(),
  extractExpenseFromImage: vi.fn(),
}));

const accepted = {
  status: "ok" as const,
  draft: {
    amount: 15200,
    currency: "ARS" as const,
    description: "Supermercado Coto",
    date: "2026-10-29",
    confidence: "high" as const,
    source_type: "bank_notification",
    card_hint: "Visa ****4521",
  },
  reason: null,
  message: "Detecté un total.",
};

function renderExpenseModal(props: Partial<React.ComponentProps<typeof ExpenseModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ExpenseModal onClose={vi.fn()} onSave={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe("ExpenseModal comprobante scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractExpenseFromImage).mockResolvedValue(accepted);
  });

  it("fills the form from a detected payment proof and asks the user to review it", async () => {
    renderExpenseModal();

    const input = screen.getByLabelText(/escanear comprobante/i);
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input).toHaveAttribute("capture", "environment");
    fireEvent.change(input, {
      target: { files: [new File(["image"], "ticket.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(screen.getByLabelText("Monto")).toHaveValue(15200));
    expect(screen.getByDisplayValue("Supermercado Coto")).toBeInTheDocument();
    expect(screen.getByText(/revisalo antes de guardar/i)).toBeInTheDocument();
    expect(screen.getByText(/bank notification/i)).toBeInTheDocument();
    expect(screen.getByText(/Visa \*\*\*\*4521/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-10-29")).toHaveAttribute("type", "date");
    expect(extractExpenseFromImage).toHaveBeenCalledWith(expect.any(File), undefined);
  });

  it("does not touch the form when the image is rejected", async () => {
    vi.mocked(extractExpenseFromImage).mockResolvedValue({
      status: "rejected",
      draft: null,
      reason: "multiple_transactions",
      message: "Detecté más de un movimiento.",
    });
    renderExpenseModal();
    fireEvent.change(screen.getByLabelText(/escanear comprobante/i), {
      target: { files: [new File(["image"], "p.png", { type: "image/png" })] },
    });

    expect(await screen.findByText(/más de un movimiento/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Monto")).toHaveValue(0);
    expect(screen.getByPlaceholderText("Ej: Supermercado Coto")).toHaveValue("");
  });

  it("asks before replacing existing form data", async () => {
    renderExpenseModal();
    fireEvent.change(screen.getByPlaceholderText("Ej: Supermercado Coto"), {
      target: { value: "Taxi" },
    });
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "1800" } });
    fireEvent.change(screen.getByLabelText(/escanear comprobante/i), {
      target: { files: [new File(["image"], "ticket.png", { type: "image/png" })] },
    });

    expect(
      await screen.findByRole("dialog", { name: "¿Reemplazar los datos actuales?" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Monto")).toHaveValue(1800);
    fireEvent.click(screen.getByRole("button", { name: "Reemplazar" }));
    await waitFor(() => expect(screen.getByLabelText("Monto")).toHaveValue(15200));
  });

  it("shows low-confidence warning and only exposes scanning on create mode", async () => {
    vi.mocked(extractExpenseFromImage).mockResolvedValue({
      ...accepted,
      draft: { ...accepted.draft, confidence: "medium" },
    });
    const { rerender } = renderExpenseModal({ mode: "installments-only" });
    expect(screen.queryByLabelText(/escanear comprobante/i)).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ExpenseModal onClose={vi.fn()} onSave={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/escanear comprobante/i), {
      target: { files: [new File(["image"], "ticket.png", { type: "image/png" })] },
    });
    expect(await screen.findByText(/revisá el total detectado/i)).toBeInTheDocument();
  });

  it("prefills the detected currency and releases the preview URL when removed", async () => {
    vi.mocked(extractExpenseFromImage).mockResolvedValue({
      ...accepted,
      draft: { ...accepted.draft, currency: "USD" },
    });
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    renderExpenseModal();
    fireEvent.change(screen.getByLabelText(/escanear comprobante/i), {
      target: { files: [new File(["image"], "ticket.png", { type: "image/png" })] },
    });

    expect(await screen.findByText("USD $")).toBeInTheDocument();
    const preview = await screen.findByAltText("Vista previa del comprobante");
    const objectUrl = preview.getAttribute("src");
    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));

    expect(screen.queryByAltText("Vista previa del comprobante")).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
  });

  it("does not offer image scanning while editing an existing expense", () => {
    const initial = {
      id: 1,
      date: "29-10-2026",
      description: "Taxi",
      amount: 1800,
      currency: "ARS",
      category_id: null,
      category_name: null,
      category_color: null,
      card: "",
      bank: "",
      person: "",
      notes: "",
    } satisfies Expense;
    renderExpenseModal({ initial });

    expect(screen.queryByLabelText(/escanear comprobante/i)).not.toBeInTheDocument();
  });
});
