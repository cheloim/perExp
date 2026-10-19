import { useCallback, useRef, useState } from "react";
import type { AssistantConfig, StreamArgs } from "./types";

const AUTH_TOKEN_KEY = "auth_token";

/**
 * POST an SSE chat request and accumulate the streamed text.
 *
 * Adapted from `AIAssistant.tsx` (the variant with `AbortSignal` support).
 */
async function streamTo(
  url: string,
  body: object,
  onChunk: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") break;
      try {
        const { text } = JSON.parse(raw) as { text: string };
        if (text) {
          full += text;
          onChunk(full);
        }
      } catch {
        /* ignore a malformed SSE frame */
      }
    }
  }
  return full;
}

/**
 * Streaming chat for one domain.
 *
 * `retry` replays the last `StreamArgs` verbatim — it never reads the prompt
 * back from input state. Routing a special prompt elsewhere (the
 * `ANALYZE_PROMPT` sentinel goes to the trends endpoint, not here) is the
 * consumer's job; this hook sends exactly what it is given.
 */
export function useAssistantChat(config: AssistantConfig) {
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastArgsRef = useRef<StreamArgs | null>(null);
  const lastOnChunkRef = useRef<((full: string) => void) | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const run = useCallback(
    async (
      args: StreamArgs,
      onChunk: (full: string) => void,
    ): Promise<string> => {
      lastArgsRef.current = args;
      lastOnChunkRef.current = onChunk;
      setError(null);
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        return await streamTo(
          config.streamUrl,
          config.buildBody(args),
          onChunk,
          controller.signal,
        );
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return "";
        setError((err as Error)?.message ?? "Error al procesar la solicitud");
        throw err;
      } finally {
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [config.streamUrl, config.buildBody],
  );

  const send = useCallback(
    (args: StreamArgs, onChunk: (full: string) => void) => run(args, onChunk),
    [run],
  );

  const retry = useCallback((): Promise<string> => {
    const args = lastArgsRef.current;
    const onChunk = lastOnChunkRef.current;
    if (!args || !onChunk) return Promise.resolve("");
    return run(args, onChunk);
  }, [run]);

  return { streaming, error, send, cancel, retry };
}
