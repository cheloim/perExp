import { memo, useEffect, useState } from "react";
import { formatAIResponse } from "../../utils/formatText";
import type { Message } from "./types";

/**
 * Dev-only render counter for `Bubble`.
 *
 * Lets e2e/assistant-perf.spec.ts assert that a streaming chunk renders ONE
 * bubble instead of all of them — a deterministic count rather than a timing
 * assertion, which would just flake in CI. `import.meta.env.DEV` is statically
 * false in a production build, so this compiles away and never ships.
 */
const countBubbleRender = () => {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __BUBBLE_RENDERS__?: number };
  w.__BUBBLE_RENDERS__ = (w.__BUBBLE_RENDERS__ ?? 0) + 1;
};

function ThinkingDots() {
  const [d, setD] = useState(".");
  useEffect(() => {
    const id = setInterval(() => setD((p) => (p.length >= 3 ? "." : p + ".")), 400);
    return () => clearInterval(id);
  }, []);
  return <span className="text-[var(--text-tertiary)] text-sm">{d}</span>;
}

/**
 * One chat bubble. Memoized so that a streaming update to the LAST message
 * does not re-run formatAIResponse on every message already on screen.
 *
 * The memo is effective because the streaming reducer copies the array but
 * keeps the untouched message objects identical (`u = [...prev]` then replaces
 * only the tail), so `msg` and `streaming` both compare equal for every bubble
 * except the one receiving the chunk. e2e/assistant-perf.spec.ts asserts the
 * resulting call count stays flat as history grows.
 */
export const Bubble = memo(({ msg, streaming }: { msg: Message; streaming: boolean }) => {
  countBubbleRender();
  const rich = msg.role === "assistant" && !!msg.text && !msg.error;
  return (
    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-4 py-3 rounded-xl text-sm leading-relaxed ${
          // Markdown owns the whitespace of a rendered reply; the other bubbles
          // keep the pre-wrap the composer writes into.
          rich ? "" : "whitespace-pre-wrap"
        } ${
          msg.role === "user"
            ? "bg-[var(--color-primary-strong)] text-[var(--color-on-primary-strong)] rounded-br-sm"
            : msg.error
              ? "bg-danger/10 border border-danger/30 text-danger rounded-bl-sm"
              : // Accent bar on the left edge: the assistant's bubble wears the
                // theme's primary, the user's the solid primary fill.
                "bg-[var(--color-base-alt)] text-[var(--text-primary)] rounded-bl-sm border-l-[3px] border-l-[var(--color-primary)]"
        }`}
      >
        {rich ? formatAIResponse(msg.text) : msg.text || (streaming ? <ThinkingDots /> : "")}
      </div>
    </div>
  );
});
