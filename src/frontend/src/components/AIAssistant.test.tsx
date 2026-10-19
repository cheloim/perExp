import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AIAssistant from "./AIAssistant";

// Collapsed chat bubble: "Abrir Asistente de Gastos"
// Panel: input placeholder "Preguntá sobre tus gastos..."
// Panel header: text "Asistente de Gastos"

describe("AIAssistant", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders nothing when open=false", () => {
    const { container } = render(<AIAssistant open={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("BUG: opening the assistant should show the panel, not a collapsed bubble", () => {
    render(<AIAssistant open={true} />);

    // The panel (side drawer) must be visible with the chat input
    const input = screen.getByPlaceholderText("Preguntá sobre tus gastos...");
    expect(input).toBeInTheDocument();

    // The collapsed floating bubble must NOT be visible
    const bubble = screen.queryByTitle("Abrir Asistente de Gastos");
    expect(bubble).not.toBeInTheDocument();
  });
});
