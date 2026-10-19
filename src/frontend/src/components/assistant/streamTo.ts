const AUTH_TOKEN_KEY = "auth_token";

/**
 * POST an SSE request and accumulate the streamed text.
 *
 * Adapted from `AIAssistant.tsx` (the variant with `AbortSignal` support).
 * Shared by `useAssistantChat` and `useSummarize`, which both talk to SSE
 * endpoints with the same frame format.
 */
export async function streamTo(
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
