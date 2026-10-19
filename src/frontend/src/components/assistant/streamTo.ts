const AUTH_TOKEN_KEY = "auth_token";

/**
 * The server said the request failed, in-band, after the response had already
 * started. Kept distinct from a transport failure so callers can show the
 * server's own words instead of a connection message.
 */
export class RemoteError extends Error {}

/**
 * POST an SSE request and accumulate the streamed text.
 *
 * Adapted from `AIAssistant.tsx` (the variant with `AbortSignal` support).
 * Shared by `useAssistantChat` and `useSummarize`, which both talk to SSE
 * endpoints with the same frame format.
 *
 * A frame marked `error: true` ends the call with a `RemoteError` instead of
 * being appended to the reply: "Error al procesar la solicitud" is not an
 * answer, and handing it back as one would leave it in the thread as if the
 * model had said it.
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
        const { text, error } = JSON.parse(raw) as { text: string; error?: boolean };
        if (error) throw new RemoteError(text || "Error al procesar la solicitud");
        if (text) {
          full += text;
          onChunk(full);
        }
      } catch (err) {
        if (err instanceof RemoteError) throw err;
        /* ignore a malformed SSE frame */
      }
    }
  }
  return full;
}
