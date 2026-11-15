import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "./LoginPage";

const requestCode = vi.fn();
const initCodeClient = vi.fn(() => ({ requestCode }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  initCodeClient.mockClear();
  requestCode.mockClear();
  window.google = {
    accounts: {
      id: {} as never,
      oauth2: { initCodeClient },
    },
  } as unknown as Window["google"];
});

describe("LoginPage — Google OAuth", () => {
  it("requests an authorization code with the parameters the callback expects", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Continuar con Google/i }));

    expect(initCodeClient).toHaveBeenCalledTimes(1);
    expect(initCodeClient).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: expect.any(String),
        scope: "email profile openid",
        ux_mode: "redirect",
        redirect_uri: `${window.location.origin}/oauth/callback`,
      }),
    );
    expect(requestCode).toHaveBeenCalledTimes(1);
  });
});

describe("LoginPage — OAuth partial tokens", () => {
  it("abre MFA con el token parcial que dejó el callback", () => {
    sessionStorage.setItem("oauth_mfa_token", "partial-mfa");

    render(
      <MemoryRouter initialEntries={["/login?mfa=required"]}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Verificación de seguridad")).toBeInTheDocument();
    expect(sessionStorage.getItem("oauth_mfa_token")).toBeNull();
  });

  it("abre el cambio obligatorio con su token parcial", () => {
    sessionStorage.setItem("oauth_force_password_token", "partial-force");

    render(
      <MemoryRouter initialEntries={["/login?force_change=1"]}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Cambio de contraseña obligatorio")).toBeInTheDocument();
    expect(sessionStorage.getItem("oauth_force_password_token")).toBeNull();
  });
});
