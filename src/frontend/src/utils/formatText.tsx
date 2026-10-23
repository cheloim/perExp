import React from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Render of the assistant's replies: real markdown (GFM) for the STRUCTURE —
 * tables, nested lists, code, quotes, links — with the hand-rolled
 * colourisation this module always had layered on top of the text nodes.
 *
 * The hybrid is deliberate. A generic markdown renderer would give us tables
 * but throw away the thing users actually value: amounts, percentages and
 * tickers painted where they appear. So `decorate` walks the children of every
 * text-bearing element and wraps those tokens in the coloured spans the old
 * line-based renderer produced, whatever the surrounding structure is — a
 * paragraph, a list item or a table cell.
 *
 * What survived from the pre-markdown renderer:
 *   - USD/ARS amounts: mono, primary (the old code only tinted USD; ARS joins in).
 *   - percentages: green when positive, red when negative.
 *   - tickers (2–5 uppercase letters): mono, primary, medium.
 *   - line tone by leading emoji (↑/📈 green, ↓/📉 red, 💡/✅ primary, ⚠/🚨
 *     yellow), approximated by tinting the element that holds the line.
 *   - `Key: value` paragraphs get the key in bold.
 *
 * What could not survive, and why:
 *   - The tone used to key on a leading `+` or `-` too. Those lines are now
 *     legitimate list markers or signed percentages: a bare `- foo` is a bullet
 *     (the marker is consumed by the parser) and `+3,2%` is a paragraph, which
 *     does get the green tint via the `+\d` rule below. A line like `- notas`
 *     loses the red tint it never really deserved.
 *   - Whole-line colour when the emoji sits mid-line (it was line-prefix
 *     based); only the prefix is inspected now.
 */

const TOKEN_RE =
  /[Uu][Ss]\$\s?\d[\d.,]*|[Uu]\$\s?[Ss]\s?\d[\d.,]*|[-+]?\d+(?:[.,]\d+)?%|\$\d[\d.,]*|\b[A-Z]{2,5}\b/g;

/** Coloured span classes for one money / percentage / ticker token. */
function tokenClass(token: string): string {
  if (token.endsWith("%")) {
    return token.startsWith("-")
      ? "text-[var(--gnome-red-3)] font-medium"
      : "text-[var(--gnome-green-5)] font-medium";
  }
  if (/^(\$\d|[Uu][Ss]\$|[Uu]\$[Ss])/.test(token)) {
    return "font-mono text-[var(--color-primary)]";
  }
  // Ticker (2–5 uppercase letters): mono + primary, as before.
  return "font-mono text-[var(--color-primary)] font-medium";
}

/** Split a text node into plain strings and coloured token spans. */
function colorizeText(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const token = m[0];
    out.push(
      <span key={`${key}-${i++}`} className={tokenClass(token)}>
        {token}
      </span>,
    );
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function firstText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    for (const child of node) {
      const text = firstText(child);
      if (text) return text;
    }
    return "";
  }
  if (React.isValidElement(node)) {
    return firstText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

/**
 * The old renderer painted a whole line when it STARTED with a trend emoji.
 * The prefix of the first text node is the closest equivalent once markdown
 * owns the structure.
 */
function toneClass(children: React.ReactNode): string {
  const t = firstText(children).replace(/^\s+/, "");
  if (/^(↑|📈|\+\d)/.test(t)) return "text-[var(--gnome-green-5)] font-medium";
  if (/^(↓|📉|-\d)/.test(t)) return "text-[var(--gnome-red-3)] font-medium";
  if (/^(💡|✅)/.test(t)) return "text-[var(--color-primary)] font-medium";
  if (/^(⚠|🚨)/.test(t)) return "text-[var(--gnome-yellow-4)] font-medium";
  return "";
}

/**
 * Recolour every text node under `node`, keeping element children untouched —
 * the components below decorate their own children, so an untouched element is
 * simply one that will decorate itself (`strong`, `em`, a nested list…).
 *
 * `boldKey` approximates the old `Key: value` rule: when the line opened with
 * a short key and a colon, the key went bold.
 */
function decorate(node: React.ReactNode, key: string, boldKey = false): React.ReactNode {
  if (typeof node === "string" || typeof node === "number") {
    const text = String(node);
    if (boldKey) {
      const m = text.match(/^([^:\n*]{1,40}):\s?/);
      if (m) {
        return [
          <strong key={`${key}-k`} className="font-semibold text-[var(--text-primary)]">
            {m[1]}:
          </strong>,
          ...colorizeText(text.slice(m[0].length), `${key}-t`),
        ];
      }
    }
    return colorizeText(text, key);
  }
  if (Array.isArray(node)) {
    return node.map((child, i) => decorate(child, `${key}-${i}`, boldKey && i === 0));
  }
  return node;
}

const markdownComponents: Components = {
  p: ({ children }) => (
    <p
      className={`mb-2 leading-relaxed whitespace-pre-line text-[var(--text-secondary)] ${toneClass(
        children,
      )}`}
    >
      {decorate(children, "p", true)}
    </p>
  ),
  h1: ({ children }) => (
    <h1 className="mt-3 mb-1.5 border-l-2 border-[var(--color-primary)] pl-2 text-lg font-semibold text-[var(--text-primary)]">
      {decorate(children, "h1")}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-1.5 border-l-2 border-[var(--color-primary)] pl-2 text-base font-semibold text-[var(--text-primary)]">
      {decorate(children, "h2")}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2.5 mb-1 border-l-2 border-[var(--color-primary)] pl-2 text-sm font-semibold text-[var(--text-primary)]">
      {decorate(children, "h3")}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
      {decorate(children, "h4")}
    </h4>
  ),
  h5: ({ children }) => <h5 className="mt-2 mb-1 text-xs text-[var(--text-tertiary)]">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-2 mb-1 text-xs text-[var(--text-tertiary)]">{children}</h6>,
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 marker:text-[var(--color-primary)]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-[var(--color-primary)]">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className={`leading-relaxed text-[var(--text-secondary)] ${toneClass(children)}`}>
      {decorate(children, "li")}
    </li>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-[var(--border-color)]">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-[var(--color-primary-strong)]/10 text-[var(--text-primary)]">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="even:bg-[var(--color-primary-strong)]/[0.05]">{children}</tr>,
  th: ({ children }) => (
    <th className="border-b border-[var(--border-color)] px-3 py-2 text-left font-semibold text-[var(--text-primary)]">
      {decorate(children, "th")}
    </th>
  ),
  td: ({ children }) => (
    <td
      className={`border-b border-[var(--border-color)] px-3 py-2 text-[var(--text-secondary)] ${toneClass(
        children,
      )}`}
    >
      {decorate(children, "td")}
    </td>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 rounded-r-xl border-l-[3px] border-[var(--color-primary)] bg-[var(--color-primary-strong)]/5 py-1.5 pl-3 pr-2 italic text-[var(--text-secondary)]">
      {decorate(children, "blockquote")}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-xl border border-[var(--border-color)] bg-[var(--color-base)] px-3 py-2.5 text-xs [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[var(--text-primary)]">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded bg-[var(--color-primary-strong)]/10 px-1 py-0.5 font-mono text-[0.85em] text-[var(--color-primary-strong)]">
      {children}
    </code>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[var(--color-primary-strong)] underline underline-offset-2 hover:opacity-80"
    >
      {decorate(children, "a")}
    </a>
  ),
  hr: () => <hr className="my-3 border-[var(--border-color)]" />,
  strong: ({ children }) => (
    <strong className="font-semibold text-[var(--text-primary)]">{decorate(children, "strong")}</strong>
  ),
  em: ({ children }) => <em className="italic">{decorate(children, "em")}</em>,
  del: ({ children }) => (
    <del className="text-[var(--text-tertiary)]">{decorate(children, "del")}</del>
  ),
};

export function formatAIResponse(text: string): React.ReactNode {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {text}
    </ReactMarkdown>
  );
}

/** Kept for callers of the pre-markdown entry point; same pipeline now. */
export function formatMarkdown(text: string): React.ReactNode {
  return formatAIResponse(text);
}
