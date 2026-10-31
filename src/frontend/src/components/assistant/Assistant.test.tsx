import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Assistant, {
  buildPortfolioContext,
  persistDrawerOpen,
  readDrawerOpen,
  DRAWER_OPEN_KEY,
} from "./Assistant";
import { getInvestments } from "../../api/client";
import { SHARED_STORAGE } from "./types";
import { THREAD_PERSISTENCE_KEY, THREAD_TIMESTAMP_KEY } from "./storage";
import type { Message } from "./types";

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
  localStorage.setItem(SHARED_STORAGE.thread, JSON.stringify(messages));
  localStorage.setItem(THREAD_TIMESTAMP_KEY, String(Date.now()));
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
    localStorage.setItem(THREAD_PERSISTENCE_KEY, "true");
    vi.mocked(getInvestments).mockReset();
    vi.mocked(getInvestments).mockResolvedValue([]);
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

  it("Limpiar vacía el hilo", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    const confirm = screen.getByRole("dialog", { name: "Limpiar conversación" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Limpiar" }));

    // An empty thread has no domain of its own, so the chrome falls back to the
    // route's — the thread still leads, not the mount snapshot.
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAccessibleName("Asistente de Inversiones"),
    );
    expect(screen.queryByRole("button", { name: "✨ Analizar gastos del mes" })).toBeNull();

    // …and the initial state with the suggestions is back.
    expect(screen.getByText("Empezá por acá")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SHARED_STORAGE.thread)!)).toEqual([]);
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

  it("never leaves the investments endpoint blind about the portfolio", () => {
    // An empty portfolio and a missing one are different facts; both must be
    // stated, never left as a silent blank the model would fill with guesses.
    expect(buildPortfolioContext([])).toContain("CARTERA ACTUAL");
    expect(buildPortfolioContext([])).toContain("sin posiciones cargadas");
  });

  it("says the snapshot is unavailable while it is still loading", async () => {
    vi.mocked(getInvestments).mockImplementation(() => new Promise(() => []));
    seed([{ role: "user", text: "cartera", domain: "investments" }]);
    const fetchMock = vi.fn(async () => fakeStream(sse("ok")));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Assistant open onToggle={() => {}} initialDomain="investments" />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "¿cómo viene mi cartera?" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).context).toContain("no está disponible");
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

  it("la migración toma la sesión más reciente y borra las legacy", async () => {
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
      "assistant_sessions",
      JSON.stringify([
        {
          id: "mid",
          ts: 2000,
          messages: [{ role: "user", text: "unificado" }],
        },
      ]),
    );
    localStorage.setItem("assistant_active", "mid");
    localStorage.setItem(
      "inv_assistant_sessions",
      JSON.stringify([
        {
          id: "old-inv",
          ts: 3000,
          messages: [{ role: "user", text: "inversión reciente" }],
        },
      ]),
    );

    const first = renderAssistant("spending");

    // The freshest session by ts becomes the thread, whatever store it came
    // from — with the domain of its store so the chrome still follows it.
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(SHARED_STORAGE.thread)!)).toEqual([
        { role: "user", text: "inversión reciente", domain: "investments" },
      ]);
    });
    for (const key of [
      "ai_assistant_sessions",
      "ai_assistant_active",
      "inv_assistant_sessions",
      "inv_assistant_active",
      "assistant_sessions",
      "assistant_active",
    ]) {
      expect(localStorage.getItem(key)).toBeNull();
    }

    // Running the migration again on a fresh mount is inert.
    first.unmount();
    renderAssistant("spending");
    expect(screen.getByText("inversión reciente")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SHARED_STORAGE.thread)!)).toEqual([
      { role: "user", text: "inversión reciente", domain: "investments" },
    ]);
  });
});
