import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantShell } from "./AssistantShell";
import { ASSISTANT_CONFIGS } from "./configs";
import { SHARED_STORAGE } from "./types";
import type { Message, Session } from "./types";

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
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeStream(sse("respuesta"))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("names the dialog from config.title for assistive tech", () => {
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Asistente de Gastos");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("applies the approved 76% x 78% geometry on desktop", () => {
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("sm:w-[76%]");
    expect(dialog.className).toContain("sm:h-[78%]");
  });

  it("autofocuses the composer 100ms after open", async () => {
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    const box = screen.getByRole("textbox");
    await waitFor(() => expect(box).toHaveFocus(), { timeout: 500 });
  });

  it("traps focus and never lets Tab or Shift+Tab escape", async () => {
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );
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
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={onToggle}
      />,
    );
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
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    expect(screen.getByText("respuesta previa")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "¿cuánto gasté?" },
    });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);

    await waitFor(() => expect(screen.getByText("respuesta")).toBeInTheDocument());
    expect(screen.getByText("respuesta previa")).toBeInTheDocument();
  });

  it("shows the analyze slot only when config.analyzeSlot is present", () => {
    const { rerender } = render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "✨ Analizar gastos del mes" })).toBeInTheDocument();

    rerender(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="investments"
        open
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "✨ Analizar gastos del mes" })).toBeNull();
  });

  it("renders nothing when closed", () => {
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Resumir writes session.summary and never overwrites the last reply", async () => {
    seed([
      { role: "user", text: "gasto", domain: "spending" },
      { role: "assistant", text: "respuesta-valiosa", domain: "spending" },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeStream(sse("RESUMEN-DE-LA-CHARLA"))),
    );
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resumir" }));

    await waitFor(() => expect(screen.getByText("RESUMEN-DE-LA-CHARLA")).toBeInTheDocument());
    // The user's reply must survive the summarize.
    expect(screen.getByText("respuesta-valiosa")).toBeInTheDocument();

    const stored = JSON.parse(localStorage.getItem(SHARED_STORAGE.sessions)!);
    expect(stored[0].summary).toBe("RESUMEN-DE-LA-CHARLA");
  });

  it("a failed monthly analysis shows the error state and retries via the slot", async () => {
    let calls = 0;
    const configs = {
      ...ASSISTANT_CONFIGS,
      spending: {
        ...ASSISTANT_CONFIGS.spending,
        analyzeSlot: {
          ...ASSISTANT_CONFIGS.spending.analyzeSlot!,
          run: () => {
            calls += 1;
            return calls === 1 ? Promise.reject(new Error("sin clave")) : Promise.resolve("listo");
          },
        },
      },
    };
    render(<AssistantShell configs={configs} initialDomain="spending" open onToggle={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "✨ Analizar gastos del mes" }));

    // The failure must be an error bubble, or the retry affordance never appears.
    await waitFor(() => expect(screen.getByText(/No pude analizar el mes/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(screen.getByText("listo")).toBeInTheDocument());
    expect(calls).toBe(2);
  });

  it("releases the open instrumentation after measuring so it cannot accumulate", async () => {
    performance.clearMarks();
    performance.clearMeasures();
    delete (window as unknown as Record<string, number | undefined>).__AI_ASSISTANT_OPEN_MS__;
    // The owner marks the open before committing the drawer state.
    performance.mark("ai-assistant:open-start");

    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    // The duration is still published where the perf budget reads it…
    await waitFor(() =>
      expect(
        (window as unknown as Record<string, number>).__AI_ASSISTANT_OPEN_MS__,
      ).toBeGreaterThan(0),
    );
    // …but nothing stays in the buffer: an unreleased mark grows the
    // performance buffer by one entry per open, forever.
    expect(performance.getEntriesByName("ai-assistant:open-start")).toHaveLength(0);
    expect(performance.getEntriesByName("ai-assistant:open-end")).toHaveLength(0);
    expect(performance.getEntriesByName("ai-assistant:open")).toHaveLength(0);
  });

  it("a stream failure tells the user to check their connection, and can be retried", async () => {
    seed([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "¿Cuánto gasté?" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);

    await waitFor(() =>
      expect(
        screen.getByText("No pude procesar la consulta. Revisá tu conexión e intentá de nuevo."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
