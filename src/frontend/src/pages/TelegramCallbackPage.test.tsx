import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TelegramCallbackPage from "./TelegramCallbackPage";
import { exchangeTelegramOidcCode, getStoredToken, storeToken } from "../api/client";
import type { AuthToken } from "../types";

vi.mock("../api/client", () => ({
  exchangeTelegramOidcCode: vi.fn(),
  getStoredToken: vi.fn(),
  storeToken: vi.fn(),
}));

const mockedExchange = vi.mocked(exchangeTelegramOidcCode);
const mockedGetStoredToken = vi.mocked(getStoredToken);
const mockedStoreToken = vi.mocked(storeToken);

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/auth/telegram/callback" element={<TelegramCallbackPage />} />
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockedGetStoredToken.mockReturnValue(null);
  window.history.replaceState(null, "", "/");
});

describe("TelegramCallbackPage", () => {
  it("canjea el código por POST y guarda el token", async () => {
    sessionStorage.setItem("telegram_oidc_state", "state-123");
    mockedExchange.mockResolvedValue({
      access_token: "access-token",
      token_type: "bearer",
    } as AuthToken);

    renderAt("/auth/telegram/callback?code=one-time&state=state-123");

    await waitFor(() => expect(mockedExchange).toHaveBeenCalledWith("one-time"));
    expect(mockedStoreToken).toHaveBeenCalledWith("access-token");
    expect(await screen.findByText("HOME")).toBeInTheDocument();
  });

  it("rechaza un state que no coincide con el guardado", async () => {
    sessionStorage.setItem("telegram_oidc_state", "expected");

    renderAt("/auth/telegram/callback?code=one-time&state=attacker");

    expect(await screen.findByText(/no es válido o expiró/i)).toBeInTheDocument();
    expect(mockedExchange).not.toHaveBeenCalled();
    expect(mockedStoreToken).not.toHaveBeenCalled();
  });

  it("no acepta tokens por query string", async () => {
    renderAt("/auth/telegram/callback?token=stolen");

    expect(await screen.findByText(/enlace de autenticación no es válido/i)).toBeInTheDocument();
    expect(mockedStoreToken).not.toHaveBeenCalled();
  });

  it("muestra un error si el código ya se usó", async () => {
    sessionStorage.setItem("telegram_oidc_state", "state-123");
    mockedExchange.mockRejectedValue(new Error("401"));

    renderAt("/auth/telegram/callback?code=used&state=state-123");

    expect(await screen.findByText(/ya se usó o expiró/i)).toBeInTheDocument();
    expect(mockedStoreToken).not.toHaveBeenCalled();
  });

  it("limpia el código y el state de la URL", async () => {
    sessionStorage.setItem("telegram_oidc_state", "state-123");
    mockedExchange.mockResolvedValue({
      access_token: "access-token",
      token_type: "bearer",
    } as AuthToken);

    renderAt("/auth/telegram/callback?code=one-time&state=state-123");

    await waitFor(() => expect(window.location.search).toBe(""));
  });
});
