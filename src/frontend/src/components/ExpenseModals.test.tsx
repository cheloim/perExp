import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { extractExpenseFromImage, getCategories } from "../api/client";
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
  drafts: [
    {
      amount: 15200,
      currency: "ARS" as const,
      description: "Supermercado Coto",
      date: "2026-10-29",
      confidence: "high" as const,
      source_type: "bank_notification",
      card_hint: "Visa ****4521",
    },
  ],
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
    expect(extractExpenseFromImage).toHaveBeenCalledWith(
      expect.any(File),
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("does not touch the form when the image is rejected", async () => {
    vi.mocked(extractExpenseFromImage).mockResolvedValue({
      status: "rejected",
      drafts: [],
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
      drafts: [{ ...accepted.drafts[0], confidence: "medium" }],
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
      drafts: [{ ...accepted.drafts[0], currency: "USD" }],
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

  it("asks before applying a result if the user edits the form while scanning", async () => {
    let resolveScan!: (response: typeof accepted) => void;
    vi.mocked(extractExpenseFromImage).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );
    renderExpenseModal();
    fireEvent.change(screen.getByLabelText(/escanear comprobante/i), {
      target: { files: [new File(["image"], "ticket.png", { type: "image/png" })] },
    });
    fireEvent.change(screen.getByPlaceholderText("Ej: Supermercado Coto"), {
      target: { value: "Taxi" },
    });

    await act(async () => resolveScan(accepted));

    expect(
      await screen.findByRole("dialog", { name: "¿Reemplazar los datos actuales?" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Monto")).toHaveValue(0);
    expect(screen.getByPlaceholderText("Ej: Supermercado Coto")).toHaveValue("Taxi");
    fireEvent.click(screen.getByRole("button", { name: "Reemplazar" }));
    await waitFor(() => expect(screen.getByLabelText("Monto")).toHaveValue(15200));
  });

  it("ignores an in-flight result after the preview is removed", async () => {
    let resolveScan!: (response: typeof accepted) => void;
    vi.mocked(extractExpenseFromImage).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );
    renderExpenseModal();
    fireEvent.change(screen.getByLabelText(/escanear comprobante/i), {
      target: { files: [new File(["image"], "ticket.png", { type: "image/png" })] },
    });
    await screen.findByAltText("Vista previa del comprobante");
    const signal = vi.mocked(extractExpenseFromImage).mock.calls[0][2] as AbortSignal;

    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
    expect(signal.aborted).toBe(true);
    await act(async () => resolveScan(accepted));

    expect(screen.getByLabelText("Monto")).toHaveValue(0);
    expect(screen.getByPlaceholderText("Ej: Supermercado Coto")).toHaveValue("");
    expect(screen.queryByText(/comprobante detectado/i)).not.toBeInTheDocument();
  });

  it("ignores an older result when a newer scan has started", async () => {
    let resolveFirst!: (response: typeof accepted) => void;
    let resolveSecond!: (response: typeof accepted) => void;
    vi.mocked(extractExpenseFromImage)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );
    renderExpenseModal();
    const input = screen.getByLabelText(/escanear comprobante/i);
    fireEvent.change(input, {
      target: { files: [new File(["first"], "first.png", { type: "image/png" })] },
    });
    fireEvent.change(input, {
      target: { files: [new File(["second"], "second.png", { type: "image/png" })] },
    });
    const newerDraft = {
      ...accepted,
      drafts: [{ ...accepted.drafts[0], amount: 4500, description: "Café" }],
    };

    await act(async () => resolveSecond(newerDraft));
    await waitFor(() => expect(screen.getByLabelText("Monto")).toHaveValue(4500));
    await act(async () => resolveFirst(accepted));

    expect(screen.getByLabelText("Monto")).toHaveValue(4500);
    expect(screen.getByPlaceholderText("Ej: Supermercado Coto")).toHaveValue("Café");
  });
});

describe("ExpenseModal cuotas y cola de revisión", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explica que el monto total se divide al activar cuotas", () => {
    renderExpenseModal();
    fireEvent.change(screen.getByPlaceholderText("Ej: Supermercado Coto"), {
      target: { value: "TV" },
    });
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "120000" } });
    fireEvent.click(screen.getByRole("button", { name: /más opciones/i }));
    fireEvent.click(screen.getByLabelText("Compra en cuotas"));

    expect(
      screen.getByText("El monto total se divide en las cuotas indicadas."),
    ).toBeInTheDocument();
    expect(screen.getByText(/12 cuotas de/)).toBeInTheDocument();
  });

  it("explica cuando se registra una cuota en curso", () => {
    renderExpenseModal();
    fireEvent.change(screen.getByPlaceholderText("Ej: Supermercado Coto"), {
      target: { value: "Netflix" },
    });
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "15000" } });
    fireEvent.click(screen.getByRole("button", { name: /más opciones/i }));
    fireEvent.click(screen.getByLabelText("Compra en cuotas"));
    fireEvent.change(screen.getByLabelText("Cuota N°"), { target: { value: "3" } });

    expect(
      screen.getByText("Estás registrando la cuota 3 de 12; se programan las restantes."),
    ).toBeInTheDocument();
    expect(screen.getByText(/se programan 9 cuotas/)).toBeInTheDocument();
  });

  it("envía el modo total cuando la cuota actual es 1", async () => {
    const onSave = vi.fn();
    renderExpenseModal({ onSave });
    fireEvent.change(screen.getByPlaceholderText("Ej: Supermercado Coto"), {
      target: { value: "TV" },
    });
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "120000" } });
    fireEvent.click(screen.getByRole("button", { name: /más opciones/i }));
    fireEvent.click(screen.getByLabelText("Compra en cuotas"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      amount: 120000,
      installment_mode: "total",
      installment_total: 12,
      installment_number: 1,
    });
  });

  it("envía el modo current cuando la cuota actual es mayor a 1", async () => {
    const onSave = vi.fn();
    renderExpenseModal({ onSave });
    fireEvent.change(screen.getByPlaceholderText("Ej: Supermercado Coto"), {
      target: { value: "Netflix" },
    });
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "15000" } });
    fireEvent.click(screen.getByRole("button", { name: /más opciones/i }));
    fireEvent.click(screen.getByLabelText("Compra en cuotas"));
    fireEvent.change(screen.getByLabelText("Cuota N°"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      amount: 15000,
      installment_mode: "current",
      installment_total: 12,
      installment_number: 3,
    });
  });

  it("revisa dos gastos con Guardar y siguiente", async () => {
    vi.mocked(extractExpenseFromImage).mockResolvedValue({
      status: "ok",
      drafts: [
        {
          amount: 1500,
          currency: "ARS",
          description: "Café",
          date: "2026-10-29",
          confidence: "high",
          source_type: "statement",
          card_hint: null,
        },
        {
          amount: 2500,
          currency: "ARS",
          description: "Farmacia",
          date: "2026-10-29",
          confidence: "high",
          source_type: "statement",
          card_hint: null,
        },
      ],
      reason: null,
      message: "Detecté 2 gastos.",
    });
    const onSave = vi.fn();
    renderExpenseModal({ onSave });
    fireEvent.change(screen.getByLabelText(/escanear comprobante/i), {
      target: { files: [new File(["image"], "resumen.png", { type: "image/png" })] },
    });

    expect(await screen.findByText(/Detecté 2 gastos/)).toBeInTheDocument();
    expect(screen.getByText("Gasto 1 de 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar y siguiente" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("Monto")).toHaveValue(2500));
    expect(screen.getByDisplayValue("Farmacia")).toBeInTheDocument();
    expect(screen.getByText("Gasto 2 de 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(screen.getByText("✅ 2 gastos guardados")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });

  it("omite un gasto y lo informa en el resumen", async () => {
    vi.mocked(extractExpenseFromImage).mockResolvedValue({
      status: "ok",
      drafts: [
        {
          amount: 1500,
          currency: "ARS",
          description: "Café",
          date: "2026-10-29",
          confidence: "high",
          source_type: "statement",
          card_hint: null,
        },
        {
          amount: 2500,
          currency: "ARS",
          description: "Farmacia",
          date: "2026-10-29",
          confidence: "high",
          source_type: "statement",
          card_hint: null,
        },
      ],
      reason: null,
      message: "Detecté 2 gastos.",
    });
    const onSave = vi.fn();
    renderExpenseModal({ onSave });
    fireEvent.change(screen.getByLabelText(/escanear comprobante/i), {
      target: { files: [new File(["image"], "resumen.png", { type: "image/png" })] },
    });

    await screen.findByText(/Detecté 2 gastos/);
    fireEvent.click(screen.getByRole("button", { name: "Omitir" }));
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Monto")).toHaveValue(2500));

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(screen.getByText("✅ 1 gasto guardado · 1 omitido")).toBeInTheDocument();
  });

  it("precarga una cuota en curso desde la imagen sin dividir", async () => {
    vi.mocked(extractExpenseFromImage).mockResolvedValue({
      status: "ok",
      drafts: [
        {
          amount: 15000,
          currency: "ARS",
          description: "Netflix",
          date: "2026-10-29",
          confidence: "high",
          source_type: "statement",
          card_hint: null,
          installment_number: 3,
          installment_total: 12,
          amount_kind: "installment",
        },
      ],
      reason: null,
      message: "Detecté un gasto.",
    });
    const onSave = vi.fn();
    renderExpenseModal({ onSave });
    fireEvent.change(screen.getByLabelText(/escanear comprobante/i), {
      target: { files: [new File(["image"], "resumen.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(screen.getByLabelText("Monto")).toHaveValue(15000));
    expect(screen.getByLabelText("Cuota N°")).toHaveValue(3);
    expect(screen.getByLabelText("Total cuotas")).toHaveValue(12);
    expect(
      screen.getByText("Estás registrando la cuota 3 de 12; se programan las restantes."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      amount: 15000,
      installment_mode: "current",
      installment_number: 3,
      installment_total: 12,
    });
  });

  it("precarga una compra con total desde la imagen y la divide", async () => {
    vi.mocked(extractExpenseFromImage).mockResolvedValue({
      status: "ok",
      drafts: [
        {
          amount: 24000,
          currency: "ARS",
          description: "Fravega",
          date: "2026-10-29",
          confidence: "high",
          source_type: "bank_notification",
          card_hint: null,
          installment_number: 1,
          installment_total: 6,
          amount_kind: "total",
        },
      ],
      reason: null,
      message: "Detecté un gasto.",
    });
    const onSave = vi.fn();
    renderExpenseModal({ onSave });
    fireEvent.change(screen.getByLabelText(/escanear comprobante/i), {
      target: { files: [new File(["image"], "resumen.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(screen.getByLabelText("Monto")).toHaveValue(24000));
    expect(screen.getByText(/6 cuotas de/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      amount: 24000,
      installment_mode: "total",
      installment_number: 1,
      installment_total: 6,
    });
  });
});

describe("ExpenseModal cola: aislamiento entre gastos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asigna un grupo de cuotas distinto a cada compra de la cola", async () => {
    vi.mocked(extractExpenseFromImage).mockResolvedValue({
      status: "ok",
      drafts: [
        {
          amount: 60000,
          currency: "ARS",
          description: "TV",
          date: "2026-10-29",
          confidence: "high",
          source_type: "statement",
          card_hint: null,
          installment_number: 1,
          installment_total: 6,
          amount_kind: "total",
        },
        {
          amount: 60000,
          currency: "ARS",
          description: "Heladera",
          date: "2026-10-29",
          confidence: "high",
          source_type: "statement",
          card_hint: null,
          installment_number: 1,
          installment_total: 6,
          amount_kind: "total",
        },
      ],
      reason: null,
      message: "Detecté 2 gastos.",
    });
    const onSave = vi.fn();
    renderExpenseModal({ onSave });
    fireEvent.change(screen.getByLabelText(/escanear comprobante/i), {
      target: { files: [new File(["image"], "resumen.png", { type: "image/png" })] },
    });

    await screen.findByText(/Detecté 2 gastos/);
    fireEvent.click(screen.getByRole("button", { name: "Guardar y siguiente" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("Monto")).toHaveValue(60000));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));

    const first = onSave.mock.calls[0][0];
    const second = onSave.mock.calls[1][0];
    expect(first.installment_group_id).toBeTruthy();
    expect(second.installment_group_id).toBeTruthy();
    expect(first.installment_group_id).not.toBe(second.installment_group_id);
  });

  it("no arrastra la categoría del gasto anterior al siguiente", async () => {
    vi.mocked(getCategories).mockResolvedValue([
      {
        id: 7,
        name: "Comida",
        parent_id: null,
        color: "#6366f1",
        keywords: "",
      } as unknown as Awaited<ReturnType<typeof getCategories>>[number],
    ]);
    vi.mocked(extractExpenseFromImage).mockResolvedValue({
      status: "ok",
      drafts: [
        {
          amount: 1500,
          currency: "ARS",
          description: "Café",
          date: "2026-10-29",
          confidence: "high",
          source_type: "statement",
          card_hint: null,
        },
        {
          amount: 2500,
          currency: "ARS",
          description: "Farmacia",
          date: "2026-10-29",
          confidence: "high",
          source_type: "statement",
          card_hint: null,
        },
      ],
      reason: null,
      message: "Detecté 2 gastos.",
    });
    const onSave = vi.fn();
    renderExpenseModal({ onSave });
    fireEvent.change(screen.getByLabelText(/escanear comprobante/i), {
      target: { files: [new File(["image"], "resumen.png", { type: "image/png" })] },
    });

    await screen.findByText(/Detecté 2 gastos/);
    fireEvent.click(screen.getByRole("button", { name: "Sin categoría" }));
    fireEvent.change(screen.getByPlaceholderText("Buscar o escribir..."), {
      target: { value: "Comida" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comida" }));

    fireEvent.click(screen.getByRole("button", { name: "Guardar y siguiente" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].category_id).toBe(7);
    await waitFor(() => expect(screen.getByLabelText("Monto")).toHaveValue(2500));
    expect(screen.getByRole("button", { name: "Sin categoría" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0].category_id).toBeNull();
  });
});
