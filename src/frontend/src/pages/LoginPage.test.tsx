import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "./LoginPage";

const requestCode = vi.fn();
const initCodeClient = vi.fn(() => ({ requestCode }));

beforeEach(() => {
  localStorage.clear();
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
