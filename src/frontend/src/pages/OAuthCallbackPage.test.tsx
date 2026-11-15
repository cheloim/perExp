import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import OAuthCallbackPage from "./OAuthCallbackPage";
import { clearPartialAuthToken, takePartialAuthToken } from "../auth/partialToken";
import { oauthCallback, storeToken } from "../api/client";
import type { AuthToken } from "../types";

vi.mock("../api/client", () => ({
  oauthCallback: vi.fn(),
  storeToken: vi.fn(),
}));

const mockedOAuth = vi.mocked(oauthCallback);
const mockedStore = vi.mocked(storeToken);

function LoginStub() {
  const location = useLocation();
  return <div>LOGIN {location.search}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="/login" element={<LoginStub />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function token(overrides: Partial<AuthToken>): AuthToken {
  return { access_token: "token", token_type: "bearer", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPartialAuthToken();
  sessionStorage.clear();
  localStorage.clear();
});

describe("OAuthCallbackPage", () => {
  it("deja el token parcial de MFA en memoria y navega a /login", async () => {
    mockedOAuth.mockResolvedValue(token({ mfa_required: true, access_token: "partial-mfa" }));

    renderAt("/oauth/callback?code=google-code");

    expect(await screen.findByText(/LOGIN.*mfa=required/)).toBeInTheDocument();
    expect(takePartialAuthToken("mfa")).toBe("partial-mfa");
    expect(mockedStore).not.toHaveBeenCalled();
  });

  it("deja el token de cambio obligatorio y navega al formulario", async () => {
    mockedOAuth.mockResolvedValue(
      token({ force_password_change: true, access_token: "partial-force" }),
    );

    renderAt("/oauth/callback?code=google-code");

    expect(await screen.findByText(/LOGIN.*force_change=1/)).toBeInTheDocument();
    expect(takePartialAuthToken("password_change")).toBe("partial-force");
    expect(mockedStore).not.toHaveBeenCalled();
  });

  it("inicia la sesión completa cuando no hay segundo factor pendiente", async () => {
    mockedOAuth.mockResolvedValue(token({ access_token: "full-token" }));

    renderAt("/oauth/callback?code=google-code");

    expect(await screen.findByText("HOME")).toBeInTheDocument();
    expect(mockedStore).toHaveBeenCalledWith("full-token");
    expect(takePartialAuthToken("mfa")).toBeNull();
  });
});
