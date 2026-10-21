import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAssistantChat } from "./useAssistantChat";
import type { AssistantConfig, StreamArgs } from "./types";

const ANALYZE_PROMPT = "✨ Analizar gastos del mes";

const CONFIG: AssistantConfig = {
  domain: "spending",
  title: "Asistente de Gastos",
  triggerLabel: "Abrir asistente",
  placeholder: "Preguntame...",
  suggestions: [],
  analyzingLabel: "Analizando tus gastos…",
  followUps: [],
  streamUrl: "/api/analysis/stream",
  buildBody: (args) => ({
    months: args.months ?? null,
    question: args.question,
    debug_mode: args.debugMode ?? false,
  }),
  rotateAfterIdleMinutes: 120,
  openBudgetMs: 300,
};

function sse(...texts: string[]): string[] {
  return [...texts.map((t) => `data: ${JSON.stringify({ text: t })}\n\n`), "data: [DONE]\n\n"];
}

type FetchOpts = { hang?: boolean; signal?: AbortSignal | null };

function fakeStream(chunks: string[], opts?: FetchOpts): Response {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
          if (opts?.hang) {
            return new Promise((_resolve, reject) => {
              const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
              if (opts.signal?.aborted) return onAbort();
              opts.signal?.addEventListener("abort", onAbort);
            });
          }
          if (i >= chunks.length) return Promise.resolve({ done: true });
          return Promise.resolve({ done: false, value: enc.encode(chunks[i++]) });
        },
      }),
    },
  } as unknown as Response;
}

type RequestRecord = {
  url: string;
  body: Record<string, unknown>;
  signal: AbortSignal | null | undefined;
};

function installFetch(build: (record: RequestRecord) => Response | Promise<Response>) {
  const calls: RequestRecord[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const record: RequestRecord = {
      url: String(url),
      body: JSON.parse(String(init.body)),
      signal: init.signal,
    };
    calls.push(record);
    return build(record);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

const baseArgs: StreamArgs = {
  question: "¿cuánto gasté?",
  history: [
    { role: "user", text: "hola", domain: "spending" },
    { role: "assistant", text: "hola!", domain: "spending" },
  ],
  months: 3,
};

describe("useAssistantChat", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("posts config.buildBody(args) to config.streamUrl and accumulates chunks", async () => {
    const { calls } = installFetch(() => fakeStream(sse("Hola ", "mundo")));

    const { result } = renderHook(() => useAssistantChat());
    let out = "";
    await act(async () => {
      await result.current.send(CONFIG, baseArgs, (full) => (out = full));
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/analysis/stream");
    expect(calls[0].body).toEqual({
      months: 3,
      question: "¿cuánto gasté?",
      debug_mode: false,
    });
    expect(out).toBe("Hola mundo");
    expect(result.current.error).toBeNull();
    expect(result.current.streaming).toBe(false);
  });

  it("hands the whole history to buildBody so the model sees prior turns", async () => {
    const seen: StreamArgs[] = [];
    const config: AssistantConfig = {
      ...CONFIG,
      buildBody: (args) => {
        seen.push(args);
        return { question: args.question };
      },
    };
    installFetch(() => fakeStream(sse("ok")));

    const { result } = renderHook(() => useAssistantChat());
    await act(async () => {
      await result.current.send(config, baseArgs, () => {});
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].history).toEqual(baseArgs.history);
    expect(seen[0].history).toHaveLength(2);
  });

  it("cancels an in-flight stream via AbortController and reports no error", async () => {
    const { calls } = installFetch((record) =>
      fakeStream([], { hang: true, signal: record.signal }),
    );

    const { result } = renderHook(() => useAssistantChat());

    let promise: Promise<string> | undefined;
    await act(async () => {
      promise = result.current.send(CONFIG, baseArgs, () => {});
      result.current.cancel();
    });
    await act(async () => {
      await promise?.catch(() => {});
    });

    expect(calls).toHaveLength(1);
    expect(result.current.streaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an HTTP error", async () => {
    installFetch(() => ({ ok: false, status: 500 }) as Response);

    const { result } = renderHook(() => useAssistantChat());
    await act(async () => {
      await result.current.send(CONFIG, baseArgs, () => {}).catch(() => {});
    });

    expect(result.current.error).toContain("500");
    expect(result.current.streaming).toBe(false);
  });

  it("retry re-sends the original prompt text, not cleared input", async () => {
    let mode: "ok" | "fail" = "fail";
    const { calls } = installFetch(() =>
      mode === "fail" ? ({ ok: false, status: 500 } as Response) : fakeStream(sse("recuperado")),
    );

    const { result } = renderHook(() => useAssistantChat());
    await act(async () => {
      await result.current.send(CONFIG, baseArgs, () => {}).catch(() => {});
    });

    mode = "ok";
    await act(async () => {
      await result.current.retry();
    });

    expect(calls).toHaveLength(2);
    expect(calls[1].body.question).toBe("¿cuánto gasté?");
  });

  it("sends a sentinel-shaped prompt verbatim — routing it elsewhere is the consumer's job", async () => {
    let mode: "ok" | "fail" = "fail";
    const { calls } = installFetch(() =>
      mode === "fail" ? ({ ok: false, status: 500 } as Response) : fakeStream(sse("listo")),
    );

    const { result } = renderHook(() => useAssistantChat());
    await act(async () => {
      await result.current
        .send(CONFIG, { ...baseArgs, question: ANALYZE_PROMPT }, () => {})
        .catch(() => {});
    });

    mode = "ok";
    await act(async () => {
      await result.current.retry();
    });

    expect(calls).toHaveLength(2);
    expect(calls[1].body.question).toBe(ANALYZE_PROMPT);
  });
});
