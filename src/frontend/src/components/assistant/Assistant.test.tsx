import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Assistant, { persistDrawerOpen, DRAWER_OPEN_KEY } from "./Assistant";
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

function renderAssistant(initialDomain: "spending" | "investments") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Assistant open onToggle={() => {}} initialDomain={initialDomain} />
    </QueryClientProvider>,
  );
}

describe("Assistant", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeStream(sse("respuesta"))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders spending chrome on an empty session started from spending", () => {
    renderAssistant("spending");

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Asistente de Gastos");
    expect(screen.getByRole("button", { name: "✨ Analizar gastos del mes" })).toBeInTheDocument();
  });

  it("switches chrome and endpoint after a message tagged investments", () => {
    seed([
      { role: "user", text: "gasto", domain: "spending" },
      { role: "assistant", text: "ok", domain: "spending" },
      { role: "user", text: "cartera", domain: "investments" },
      { role: "assistant", text: "ok", domain: "investments" },
    ]);

    renderAssistant("spending");

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Asistente de Inversiones");
    expect(screen.queryByRole("button", { name: "✨ Analizar gastos del mes" })).toBeNull();
  });

  it("does not change chrome when the route changes mid-conversation", () => {
    seed([{ role: "user", text: "gasto", domain: "spending" }]);

    const { rerender } = renderAssistant("spending");
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Asistente de Gastos");

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    rerender(
      <QueryClientProvider client={client}>
        <Assistant open onToggle={() => {}} initialDomain="investments" />
      </QueryClientProvider>,
    );

    // The last message is spending; the route must not swap the persona.
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Asistente de Gastos");
  });

  it("escape closes the dialog and persists the closed state", async () => {
    persistDrawerOpen(true);
    expect(localStorage.getItem(DRAWER_OPEN_KEY)).toBe("true");

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Assistant open onToggle={() => {}} initialDomain="spending" />
      </QueryClientProvider>,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(localStorage.getItem(DRAWER_OPEN_KEY)).toBe("false"));
  });

  it("merges the two legacy stores into one shared thread on first render", async () => {
    localStorage.setItem(
      "ai_assistant_sessions",
      JSON.stringify([
        {
          id: "old-spend",
          ts: 1000,
          messages: [{ role: "user", text: "gasto viejo" }],
        },
      ]),
    );
    localStorage.setItem(
      "inv_assistant_sessions",
      JSON.stringify([
        {
          id: "old-inv",
          ts: 2000,
          messages: [{ role: "user", text: "inversión vieja" }],
        },
      ]),
    );

    renderAssistant("spending");

    await waitFor(() => {
      const merged = JSON.parse(localStorage.getItem(SHARED_STORAGE.sessions)!);
      expect(merged.map((s: { id: string }) => s.id)).toEqual(["old-spend", "old-inv"]);
    });
  });
});
