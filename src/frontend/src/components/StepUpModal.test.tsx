import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StepUpModal from "./StepUpModal";
import { adminStepUp } from "../api/client";

vi.mock("../api/client", () => ({ adminStepUp: vi.fn() }));

const mockedStepUp = vi.mocked(adminStepUp);

function renderModal(props: { mfaEnabled?: boolean; onAuthenticated: () => void }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StepUpModal onCancel={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedStepUp.mockResolvedValue({ step_up_token: "step-up", expires_in: 300 });
});

describe("StepUpModal", () => {
  it("verifica la contraseña y ejecuta la acción", async () => {
    const onAuthenticated = vi.fn();
    renderModal({ onAuthenticated });

    fireEvent.change(screen.getByPlaceholderText("Contraseña"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(mockedStepUp).toHaveBeenCalledWith("secret", undefined);
  });

  it("pide el código MFA cuando el admin lo tiene habilitado", async () => {
    const onAuthenticated = vi.fn();
    renderModal({ mfaEnabled: true, onAuthenticated });

    fireEvent.change(screen.getByPlaceholderText("Contraseña"), {
      target: { value: "secret" },
    });
    fireEvent.change(screen.getByPlaceholderText("Código MFA"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(mockedStepUp).toHaveBeenCalledWith("secret", "123456");
  });
});
