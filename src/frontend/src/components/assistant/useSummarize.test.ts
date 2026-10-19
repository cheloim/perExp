import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSummarize } from "./useSummarize";
import type { Message } from "./types";

function sse(...texts: string[]): string[] {
  return [
    ...texts.map((t) => `data: ${JSON.stringify({ text: t })}\n\n`),
    "data: [DONE]\n\n",
  ];
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

const MESSAGES: Message[] = [
  { role: "user", text: "¿cuánto gasté?", domain: "spending" },
  { role: "assistant", text: "$120.000", domain: "spending" },
];

describe("useSummarize", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("posts the messages to /api/analysis/summarize and streams the summary", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return fakeStream(sse("Resumen ", "de la charla"));
      }),
    );

    const { result } = renderHook(() => useSummarize());
    let out = "";
    await act(async () => {
      await result.current.summarize(MESSAGES, (full) => (out = full));
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/analysis/summarize");
    expect(calls[0].body).toEqual({ messages: MESSAGES });
    expect(out).toBe("Resumen de la charla");
    expect(result.current.summarizing).toBe(false);
  });

  it("leaves summarizing true while the request is in flight", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => fakeStream(sse("ok"))),
    );

    const { result } = renderHook(() => useSummarize());
    act(() => {
      void result.current.summarize(MESSAGES, () => {});
    });

    expect(result.current.summarizing).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.summarizing).toBe(false);
  });
});
