import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantShell } from "./AssistantShell";
import { ASSISTANT_CONFIGS } from "./configs";
import { SHARED_STORAGE } from "./types";
import type { Message, Session } from "./types";

function sse(...texts: string[]): string[] {
  return [...texts.map((t) => `data: ${JSON.stringify({ text: t })}\n\n`), "data: [DONE]\n\n"];
}

/** A frame the server marked as a failure, not as part of the reply. */
function sseError(text: string): string[] {
  return [`data: ${JSON.stringify({ error: true, text })}\n\n`, "data: [DONE]\n\n"];
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

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

  it("the streaming status names the domain being analysed", async () => {
    // A stream that never settles keeps `streaming` true so the status is visible.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="investments"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "¿Cómo viene mi cartera?" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);

    await waitFor(() => expect(screen.getByText("Analizando tus inversiones…")).toBeVisible());
    expect(screen.queryByText("Analizando tus gastos…")).toBeNull();
  });

  it("follow-up suggestions follow the domain of the thread", () => {
    seed([
      { role: "user", text: "gasté 100", domain: "spending" },
      { role: "assistant", text: "ok", domain: "spending" },
    ]);
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    const group = screen.getByRole("group", { name: "Sugerencias de seguimiento" });
    expect(group).toHaveTextContent("¿Dónde más puedo recortar?");
    // Investments follow-ups must not leak into a spending thread.
    expect(group).not.toHaveTextContent("Detallame por activo");
  });

  it("follow-up suggestions follow the thread, not the route that seeds it", () => {
    seed([
      { role: "user", text: "¿Cómo viene mi cartera?", domain: "investments" },
      { role: "assistant", text: "Va bien", domain: "investments" },
    ]);
    const { rerender } = render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="investments"
        open
        onToggle={() => {}}
      />,
    );

    expect(screen.getByRole("group", { name: "Sugerencias de seguimiento" })).toHaveTextContent(
      "Detallame por activo",
    );

    // Navigating must not swap the thread's persona.
    rerender(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );
    const group = screen.getByRole("group", { name: "Sugerencias de seguimiento" });
    expect(group).toHaveTextContent("Detallame por activo");
    expect(group).not.toHaveTextContent("¿Dónde más puedo recortar?");
  });

  it("deleting a session asks for one confirmation, not two", () => {
    // Two sessions so the target shows up in Conversaciones (the active one is hidden).
    const old: Session = {
      id: "old",
      ts: Date.now() - 60_000,
      messages: [{ role: "user", text: "gasto viejo", domain: "spending" }],
    };
    const active: Session = { id: "active", ts: Date.now(), messages: [] };
    localStorage.setItem(SHARED_STORAGE.sessions, JSON.stringify([old, active]));
    localStorage.setItem(SHARED_STORAGE.active, "active");

    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Conversaciones/ }));
    fireEvent.click(screen.getByText("gasto viejo")); // expand the card
    fireEvent.click(screen.getByRole("button", { name: "Eliminar sesión" }));

    // The trash opens the shared ConfirmDialog directly — no inline "¿Eliminar?"
    // step in between — so exactly one Eliminar affordance is on screen.
    expect(screen.getAllByRole("button", { name: "Eliminar" })).toHaveLength(1);
    expect(screen.queryByText("¿Eliminar?")).toBeNull();
  });

  it("routes an investments question to the investments endpoint and flips the chrome", async () => {
    seed([{ role: "user", text: "gasté 100 en el super", domain: "spending" }]);
    const fetchMock = vi.fn(async () => fakeStream(sse("respuesta de cartera")));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "¿cómo viene mi cartera?" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);

    await waitFor(() => expect(screen.getByText("respuesta de cartera")).toBeInTheDocument());

    // The message routes to the investments endpoint — separate model, separate key.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("/api/investments/chat/stream");
    // …and the whole thread went with it, not just the question.
    const body = JSON.parse(init.body);
    expect(body.question).toBe("¿cómo viene mi cartera?");
    expect(body.messages).toEqual([{ role: "user", text: "gasté 100 en el super" }]);

    // The chrome follows the message that was actually answered.
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAccessibleName("Asistente de Inversiones"),
    );
  });

  it("a rotated session starts clean instead of inheriting the old thread", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    seed([{ role: "user", text: "gasté 100 en el super", domain: "spending" }]);

    const fetchMock = vi.fn(async () => fakeStream(sse("ok")));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    // Three hours later the spending surface rotates (its threshold is 120 min).
    vi.setSystemTime(new Date("2026-10-19T15:00:00Z"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "¿cuánto gasté este mes?" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Rotation summarizes the thread it left behind first, so the chat request
    // is not necessarily the first fetch — find it by URL.
    const chatCall = (fetchMock.mock.calls as unknown as [string, { body: string }][]).find(
      ([url]) => url === "/api/analysis/stream",
    );
    expect(chatCall, "the chat request never went out").toBeDefined();
    // A "new" session must not answer with the old conversation still attached.
    expect(JSON.parse(chatCall![1].body).messages).toEqual([]);
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

  it("retry replays the question once, not in the history and again as the question", async () => {
    seed([
      { role: "user", text: "gasté 100", domain: "spending" },
      { role: "assistant", text: "$100", domain: "spending" },
    ]);
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new TypeError("Failed to fetch");
      })
      .mockImplementationOnce(async () => fakeStream(sse("respuesta")));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "¿y el mes pasado?" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByText("respuesta")).toBeInTheDocument());

    const bodies = (fetchMock.mock.calls as unknown as [string, { body: string }][]).map(
      ([, init]) => JSON.parse(init.body),
    );
    // The replay sends the thread as it stood before the failed turn: the
    // question is the question, never a prior turn as well.
    for (const body of bodies) {
      expect(body.question).toBe("¿y el mes pasado?");
      expect(body.messages).toEqual([
        { role: "user", text: "gasté 100" },
        { role: "assistant", text: "$100" },
      ]);
    }
  });

  it("an error frame is shown as an error and never travels back as a reply", async () => {
    seed([]);
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => fakeStream(sseError("LLM_API_KEY no configurada.")))
      .mockImplementationOnce(async () => fakeStream(sse("ok")));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "¿cuánto gasté?" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);

    // The server's own words, in the error bubble — with the retry affordance
    // that marks it a failure instead of a reply.
    await waitFor(() =>
      expect(screen.getByText("LLM_API_KEY no configurada.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hola de nuevo" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));

    const [, init] = fetchMock.mock.calls[1] as unknown as [string, { body: string }];
    // The question the user asked is still a turn — but what the server marked
    // as an error is not a reply and must not travel back as one.
    expect(JSON.parse(init.body).messages).toEqual([{ role: "user", text: "¿cuánto gasté?" }]);
  });
});
