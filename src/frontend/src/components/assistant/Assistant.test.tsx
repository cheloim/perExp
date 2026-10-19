import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Assistant, { persistDrawerOpen, readDrawerOpen, DRAWER_OPEN_KEY } from "./Assistant";
import { getInvestments } from "../../api/client";
import { SHARED_STORAGE } from "./types";
import type { Message, Session } from "./types";

// Only `getInvestments` is faked — it is the request this file is about to
// start gating. Everything else stays real so the chrome tests keep covering
// the real configs.
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return { ...actual, getInvestments: vi.fn(async () => []) };
});

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

  it("chrome follows the thread when a new session is started, not the mount snapshot", async () => {
    seed([{ role: "user", text: "gasto", domain: "spending" }]);

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Assistant open onToggle={() => {}} initialDomain="investments" />
      </QueryClientProvider>,
    );

    // Seeded thread is spending, so the window wears spending chrome even on
    // the investments route.
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Asistente de Gastos");

    fireEvent.click(screen.getByRole("button", { name: "Nueva" }));

    // A fresh session has no messages, so it falls back to the route's domain.
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAccessibleName("Asistente de Inversiones"),
    );
    expect(screen.queryByRole("button", { name: "✨ Analizar gastos del mes" })).toBeNull();
  });

  it("reads back exactly what the drawer writer stores", () => {
    // The key is part of the persisted contract: renaming it silently orphans
    // every user's saved drawer state.
    expect(DRAWER_OPEN_KEY).toBe("ai_drawer_open");

    expect(readDrawerOpen()).toBe(false);
    persistDrawerOpen(true);
    expect(localStorage.getItem(DRAWER_OPEN_KEY)).toBe("true");
    expect(readDrawerOpen()).toBe(true);
    persistDrawerOpen(false);
    expect(localStorage.getItem(DRAWER_OPEN_KEY)).toBe("false");
    expect(readDrawerOpen()).toBe(false);
  });

  it("fetches the portfolio snapshot only while the drawer is open", async () => {
    const mocked = vi.mocked(getInvestments);
    mocked.mockClear();

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <Assistant open={false} onToggle={() => {}} initialDomain="investments" />
      </QueryClientProvider>,
    );

    // Closed: the snapshot the investments endpoint wants must not be fetched.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocked).not.toHaveBeenCalled();

    rerender(
      <QueryClientProvider client={client}>
        <Assistant open onToggle={() => {}} initialDomain="investments" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(1));
  });

  it("escape asks the owner to close — the owner's write is what persists", async () => {
    persistDrawerOpen(true);
    expect(readDrawerOpen()).toBe(true);

    // App is the single writer: every open/close path funnels through
    // `toggleDrawer`, which persists. The shell only asks.
    const ownerToggle = vi.fn(() => persistDrawerOpen(false));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Assistant open onToggle={ownerToggle} initialDomain="spending" />
      </QueryClientProvider>,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(ownerToggle).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(readDrawerOpen()).toBe(false));
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
