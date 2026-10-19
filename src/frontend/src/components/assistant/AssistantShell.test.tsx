import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantShell } from "./AssistantShell";
import { ASSISTANT_CONFIGS } from "./configs";
import { SHARED_STORAGE } from "./types";
import type { AssistantConfig, Message, Session } from "./types";

function sse(...texts: string[]): string[] {
  return [...texts.map((t) => `data: ${JSON.stringify({ text: t })}\n\n`), "data: [DONE]\n\n"];
}

function fakeStream(chunks: string[]): Response {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
          if (i >= chunks.length) return Promise.resolve({ done: true });
          return Promise.resolve({ done: false, value: enc.encode(chunks[i++]) });
        },
      }),
    },
  } as unknown as Response;
}

function seed(messages: Message[]): void {
  const session: Session = {
    id: "s1",
    ts: Date.now(),
    lastMessageTs: Date.now(),
    messages,
  };
  localStorage.setItem(SHARED_STORAGE.sessions, JSON.stringify([session]));
  localStorage.setItem(SHARED_STORAGE.active, "s1");
}

describe("AssistantShell", () => {
  const spending: AssistantConfig = ASSISTANT_CONFIGS.spending;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeStream(sse("respuesta"))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("names the dialog from config.title for assistive tech", () => {
    render(<AssistantShell config={spending} open onToggle={() => {}} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Asistente de Gastos");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("applies the approved 76% x 78% geometry on desktop", () => {
    render(<AssistantShell config={spending} open onToggle={() => {}} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("sm:w-[76%]");
    expect(dialog.className).toContain("sm:h-[78%]");
  });

  it("autofocuses the composer 100ms after open", async () => {
    render(<AssistantShell config={spending} open onToggle={() => {}} />);

    const box = screen.getByRole("textbox");
    await waitFor(() => expect(box).toHaveFocus(), { timeout: 500 });
  });

  it("traps focus and never lets Tab or Shift+Tab escape", async () => {
    render(<AssistantShell config={spending} open onToggle={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const box = screen.getByRole("textbox");
    await waitFor(() => expect(box).toHaveFocus(), { timeout: 500 });

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("escape asks the owner to close, so the close can be persisted", async () => {
    const onToggle = vi.fn();
    seed([]);
    render(<AssistantShell config={spending} open onToggle={onToggle} />);
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "Escape" });

    // Persistence is the owner's job (App wires onToggle to the drawer flag);
    // the shell must not bypass it the way the pre-#415 code did.
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("streams into the last bubble without disturbing earlier messages", async () => {
    seed([
      { role: "user", text: "hola", domain: "spending" },
      { role: "assistant", text: "respuesta previa", domain: "spending" },
    ]);
    render(<AssistantShell config={spending} open onToggle={() => {}} />);

    expect(screen.getByText("respuesta previa")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "¿cuánto gasté?" },
    });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);

    await waitFor(() => expect(screen.getByText("respuesta")).toBeInTheDocument());
    expect(screen.getByText("respuesta previa")).toBeInTheDocument();
  });

  it("shows the analyze slot only when config.analyzeSlot is present", () => {
    const { rerender } = render(<AssistantShell config={spending} open onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "✨ Analizar gastos del mes" })).toBeInTheDocument();

    rerender(<AssistantShell config={ASSISTANT_CONFIGS.investments} open onToggle={() => {}} />);
    expect(screen.queryByRole("button", { name: "✨ Analizar gastos del mes" })).toBeNull();
  });

  it("renders nothing when closed", () => {
    render(<AssistantShell config={spending} open={false} onToggle={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
