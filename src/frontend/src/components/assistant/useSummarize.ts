import { useCallback, useState } from "react";
import { streamTo } from "./streamTo";
import type { Message } from "./types";

const SUMMARIZE_URL = "/api/analysis/summarize";

/**
 * Summarize a conversation for session resume / the history tab.
 *
 * Both domains already share this one endpoint, so there is no per-domain
 * config here.
 */
export function useSummarize() {
  const [summarizing, setSummarizing] = useState(false);

  const summarize = useCallback(
    async (messages: Message[], onChunk: (full: string) => void): Promise<string> => {
      if (messages.length === 0) return "";
      setSummarizing(true);
      try {
        return await streamTo(SUMMARIZE_URL, { messages }, onChunk);
      } catch {
        // A failed summary is not worth an error bubble: nothing is lost, and
        // the failure text would otherwise be stored as if it were the
        // conversation being summarized.
        return "";
      } finally {
        setSummarizing(false);
      }
    },
    [],
  );

  return { summarizing, summarize };
}
