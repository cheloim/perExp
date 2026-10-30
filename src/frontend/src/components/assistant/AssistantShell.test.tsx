import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AssistantShell } from "./AssistantShell";
import { ASSISTANT_CONFIGS } from "./configs";
import { SHARED_STORAGE } from "./types";
import type { Message } from "./types";
import { useVoiceInput } from "../../hooks/useVoiceInput";

vi.mock("../../hooks/useVoiceInput", () => ({ useVoiceInput: vi.fn() }));

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
  localStorage.setItem(SHARED_STORAGE.thread, JSON.stringify(messages));
}

describe("AssistantShell", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useVoiceInput).mockReturnValue({
      supported: false,
      state: "idle",
      error: null,
      elapsed: 0,
      start: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeStream(sse("respuesta"))),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("hides the mic when recording is unsupported", () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      supported: false,
      state: "idle",
      error: null,
      elapsed: 0,
      start: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
    });
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: /grabar/i })).not.toBeInTheDocument();
  });

  it("puts the transcript in the composer without sending it", async () => {
    vi.mocked(useVoiceInput).mockImplementation(({ onTranscript }) => ({
      supported: true,
      state: "idle",
      error: null,
      elapsed: 0,
      start: async () => onTranscript("¿cuánto gasté?"),
      stop: vi.fn(),
      cancel: vi.fn(),
    }));
    const fetchSpy = vi.fn(async () => fakeStream(sse("respuesta")));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /grabar/i }));

    expect(screen.getByRole("textbox")).toHaveValue("¿cuánto gasté?");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("cancels voice recording when the assistant closes", () => {
    let recording = false;
    let onTranscriptSpy = vi.fn<(text: string) => void>();
    let completeRecording = () => {};
    const start = vi.fn(async () => {
      recording = true;
    });
    const cancel = vi.fn(() => {
      recording = false;
    });
    vi.mocked(useVoiceInput).mockImplementation(({ onTranscript }) => {
      onTranscriptSpy = vi.fn(onTranscript);
      completeRecording = () => {
        if (recording) onTranscriptSpy("transcripción tardía");
      };
      return {
        supported: true,
        state: "idle",
        error: null,
        elapsed: 1,
        start,
        stop: vi.fn(),
        cancel,
      };
    });

    const { rerender } = render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /grabar/i }));
    expect(start).toHaveBeenCalledOnce();

    rerender(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open={false}
        onToggle={() => {}}
      />,
    );
    act(() => completeRecording());

    expect(cancel).toHaveBeenCalledOnce();
    expect(onTranscriptSpy).not.toHaveBeenCalled();

    rerender(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
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

  it("el tope de 200 mensajes recorta los más viejos", async () => {
    const history: Message[] = Array.from({ length: 205 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `m${i}`,
      domain: "spending",
    }));
    seed(history);
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hola" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(screen.getByText("respuesta")).toBeInTheDocument());

    const stored = JSON.parse(localStorage.getItem(SHARED_STORAGE.thread)!) as Message[];
    // 205 seeded + the new pair is 207: the seven oldest go, the newest stay.
    expect(stored).toHaveLength(200);
    expect(stored[0].text).toBe("m7");
    expect(stored.some((m) => m.text === "m0")).toBe(false);
    expect(stored[stored.length - 1].text).toBe("respuesta");
  });

  it("el tope de 256 KB recorta los más viejos cuando llega antes", async () => {
    const big = (n: number): Message => ({
      role: "user",
      text: `grande-${n} ${"a".repeat(120_000)}`,
      domain: "spending",
    });
    seed([big(0), big(1), big(2)]);
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hola" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(screen.getByText("respuesta")).toBeInTheDocument());

    const stored = JSON.parse(localStorage.getItem(SHARED_STORAGE.thread)!) as Message[];
    // Three ~120 KB exchanges break the 256 KB budget before the count cap
    // ever matters, and the oldest is the one that goes.
    expect(stored.some((m) => m.text.startsWith("grande-0"))).toBe(false);
    expect(stored[0].text.startsWith("grande-1")).toBe(true);
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

  it("Limpiar asks once with the agreed copy and only clears on confirm", () => {
    seed([
      { role: "user", text: "gasto viejo", domain: "spending" },
      { role: "assistant", text: "$100", domain: "spending" },
    ]);

    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));

    // The trash opens the shared ConfirmDialog directly — no inline step in
    // between — so exactly one Limpiar affordance is on screen.
    const confirm = screen.getByRole("dialog", { name: "Limpiar conversación" });
    expect(
      within(confirm).getByText(
        "Esto borra los mensajes de esta conversación. No se puede deshacer.",
      ),
    ).toBeInTheDocument();
    expect(within(confirm).getAllByRole("button", { name: "Limpiar" })).toHaveLength(1);

    // Cancelling keeps the thread.
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByText("gasto viejo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    const reopened = screen.getByRole("dialog", { name: "Limpiar conversación" });
    fireEvent.click(within(reopened).getByRole("button", { name: "Limpiar" }));

    expect(screen.queryByText("gasto viejo")).toBeNull();
    expect(JSON.parse(localStorage.getItem(SHARED_STORAGE.thread)!)).toEqual([]);
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

  it("una sugerencia inicial envía la pregunta al tocarla, sin pasar por el formulario", async () => {
    const fetchMock = vi.fn(async () => fakeStream(sse("respuesta")));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    // A draft the user typed but never submitted: the suggestion must send its
    // own question and drop the draft, not smuggle it through the form.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "borrador sin enviar" } });
    fireEvent.click(screen.getByRole("button", { name: "¿Cuánto llevo gastado este mes?" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    // The turn that went out is the suggestion — the form's onSubmit path
    // would have sent the textarea contents instead.
    expect(JSON.parse(init.body).question).toBe("¿Cuánto llevo gastado este mes?");
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByText("borrador sin enviar")).toBeNull();
  });

  it("una sugerencia de seguimiento envía la pregunta al tocarla, sin pasar por el formulario", async () => {
    seed([
      { role: "user", text: "gasté 100", domain: "spending" },
      { role: "assistant", text: "ok", domain: "spending" },
    ]);
    const fetchMock = vi.fn(async () => fakeStream(sse("respuesta")));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "borrador sin enviar" } });
    const group = screen.getByRole("group", { name: "Sugerencias de seguimiento" });
    fireEvent.click(within(group).getByRole("button", { name: "¿Dónde más puedo recortar?" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).question).toBe("¿Dónde más puedo recortar?");
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByText("borrador sin enviar")).toBeNull();
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

  it("analyses twelve months by default and follows the period selector", async () => {
    seed([]);
    const fetchMock = vi.fn(async () => fakeStream(sse("respuesta")));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="spending"
        open
        onToggle={() => {}}
      />,
    );

    // The window in force is visible: the selector names it and marks it.
    const periods = screen.getByRole("group", { name: "Período de análisis" });
    expect(within(periods).getByRole("button", { name: "12m" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "¿cómo vengo?" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, first] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(first.body).months).toBe(12);

    fireEvent.click(within(periods).getByRole("button", { name: "6m" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "¿cuánto gasté?" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, second] = fetchMock.mock.calls[1] as unknown as [string, { body: string }];
    expect(JSON.parse(second.body).months).toBe(6);
    expect(within(periods).getByRole("button", { name: "6m" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("offers no period to the investments domain, whose endpoint takes none", () => {
    seed([]);
    render(
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain="investments"
        open
        onToggle={() => {}}
      />,
    );

    expect(screen.queryByRole("group", { name: "Período de análisis" })).toBeNull();
  });
});
