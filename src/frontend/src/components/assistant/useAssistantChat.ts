import { useCallback, useRef, useState } from "react";
import { streamTo } from "./streamTo";
import type { AssistantConfig, StreamArgs } from "./types";

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
    async (args: StreamArgs, onChunk: (full: string) => void): Promise<string> => {
      lastArgsRef.current = args;
      lastOnChunkRef.current = onChunk;
      setError(null);
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        return await streamTo(config.streamUrl, config.buildBody(args), onChunk, controller.signal);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return "";
        setError((err as Error)?.message ?? "Error al procesar la solicitud");
        throw err;
      } finally {
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [config],
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
