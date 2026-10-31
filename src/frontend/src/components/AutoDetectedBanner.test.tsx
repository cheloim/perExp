import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AutoDetectedBanner from "./AutoDetectedBanner";
import {
  confirmRecurringExpense,
  deleteRecurringExpense,
  getAutoDetectedRecurring,
  updateRecurringExpense,
} from "../api/client";
import type { RecurringExpense } from "../api/client";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getAutoDetectedRecurring: vi.fn(),
    confirmRecurringExpense: vi.fn(),
    deleteRecurringExpense: vi.fn(),
    updateRecurringExpense: vi.fn(),
    dismissAutoDetectedBanner: vi.fn(),
  };
});

const RECURRING = [
  {
    id: 1,
    merchant_key: "Netflix",
    amount: 8000,
    frequency: "monthly",
    next_charge_date: "2026-11-05",
    is_active: false,
  },
  {
    id: 2,
    merchant_key: "Spotify",
    amount: 4500,
    frequency: "monthly",
    next_charge_date: "2026-11-10",
    is_active: false,
  },
] as RecurringExpense[];

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutoDetectedBanner />
    </QueryClientProvider>,
  );
}

async function openReview() {
  renderBanner();
  fireEvent.click(await screen.findByRole("button", { name: "Revisar" }));
  return screen.getByRole("dialog", { name: "Gastos auto-detectados" });
}

describe("AutoDetectedBanner", () => {
  beforeEach(() => {
    vi.mocked(getAutoDetectedRecurring).mockResolvedValue(RECURRING);
    vi.mocked(confirmRecurringExpense).mockResolvedValue(RECURRING[0]);
    vi.mocked(updateRecurringExpense).mockResolvedValue(RECURRING[0]);
    vi.mocked(deleteRecurringExpense).mockResolvedValue(undefined);
  });

  it("opens the review as an accessible dialog", async () => {
    const dialog = await openReview();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("Netflix")).toBeInTheDocument();
    expect(within(dialog).getByText("Spotify")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    await openReview();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Gastos auto-detectados" })).toBeNull(),
    );
  });

  it("closes on backdrop click", async () => {
    const dialog = await openReview();

    fireEvent.click(dialog.parentElement!);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Gastos auto-detectados" })).toBeNull(),
    );
  });

  it("confirms a single detected recurrence", async () => {
    const dialog = await openReview();

    const card = within(dialog).getByText("Netflix").closest("div")!.parentElement!.parentElement!;
    fireEvent.click(within(card).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(confirmRecurringExpense).toHaveBeenCalledWith(1));
  });

  it("edits amount and frequency, then confirms with the new values", async () => {
    const dialog = await openReview();

    fireEvent.click(within(dialog).getAllByRole("button", { name: "Editar" })[0]);
    fireEvent.change(within(dialog).getByLabelText("Monto"), { target: { value: "9000" } });
    fireEvent.change(within(dialog).getByLabelText("Frecuencia"), {
      target: { value: "yearly" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar y confirmar" }));

    await waitFor(() => expect(confirmRecurringExpense).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(updateRecurringExpense).toHaveBeenCalledWith(1, {
        amount: 9000,
        next_charge_date: "2026-11-05",
        frequency: "yearly",
      }),
    );
  });

  it("confirms every detected recurrence at once", async () => {
    const dialog = await openReview();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar todos" }));

    await waitFor(() => expect(confirmRecurringExpense).toHaveBeenCalledTimes(2));
    expect(confirmRecurringExpense).toHaveBeenCalledWith(1);
    expect(confirmRecurringExpense).toHaveBeenCalledWith(2);
  });
});
