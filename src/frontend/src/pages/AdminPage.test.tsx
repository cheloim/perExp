import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminPage from "./AdminPage";

vi.mock("./admin/CategorizationReviewTab", () => ({
  default: () => <div>CATEGORIZATION_TAB</div>,
}));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getAdminUsers: vi.fn(async () => ({ users: [], total: 0 })),
  };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AdminPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    value: 1440,
    writable: true,
    configurable: true,
  });
});

describe("AdminPage", () => {
  it("muestra el tab de Categorización junto a los existentes", () => {
    renderPage();

    for (const label of [
      "Usuarios",
      "Logs & Seguridad",
      "Reportes",
      "Sistema",
      "Métricas",
      "Categorización",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("al hacer click en Categorización renderiza la revisión interna", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Categorización" }));

    expect(screen.getByText("CATEGORIZATION_TAB")).toBeInTheDocument();
  });
});
