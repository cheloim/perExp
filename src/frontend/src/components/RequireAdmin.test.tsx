import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import RequireAdmin from "./RequireAdmin";
import { getMe } from "../api/client";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, getMe: vi.fn() };
});

const mockedGetMe = vi.mocked(getMe);

function renderGuard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RequireAdmin>
          <div>ADMIN_CONTENT</div>
        </RequireAdmin>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("auth_token", "token");
});

describe("RequireAdmin", () => {
  it("muestra 403 a un usuario que no es admin", async () => {
    mockedGetMe.mockResolvedValue({
      id: 1,
      email: "user@example.com",
      full_name: "User",
      is_active: true,
      created_at: "",
      is_admin: false,
    });

    renderGuard();

    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(screen.queryByText("ADMIN_CONTENT")).not.toBeInTheDocument();
  });

  it("deja pasar a un admin", async () => {
    mockedGetMe.mockResolvedValue({
      id: 1,
      email: "admin@example.com",
      full_name: "Admin",
      is_active: true,
      created_at: "",
      is_admin: true,
    });

    renderGuard();

    expect(await screen.findByText("ADMIN_CONTENT")).toBeInTheDocument();
  });
});
