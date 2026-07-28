import React from "react";

function renderMarkdown(text: string): React.ReactNode[] {
  const segments: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push(text.slice(lastIndex, match.index));
    }
    const m = match[0];
    if (m.startsWith("**") && m.endsWith("**")) {
      segments.push(
        <strong key={segments.length} className="font-semibold text-[var(--text-primary)]">
          {m.slice(2, -2)}
        </strong>,
      );
    } else if (m.startsWith("*") && m.endsWith("*")) {
      segments.push(
        <em key={segments.length} className="italic">
          {m.slice(1, -1)}
        </em>,
      );
    }
    lastIndex = match.index + m.length;
  }

  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  return segments.length > 0 ? segments : [text];
}

function processLine(line: string, lineIdx: number): React.ReactNode {
  const trimmed = line.trim();

  if (!trimmed) return <br key={lineIdx} />;

  if (trimmed.startsWith("↑") || trimmed.startsWith("+") || trimmed.startsWith("📈")) {
    return (
      <p key={lineIdx} className="text-[var(--gnome-green-5)] font-medium mb-1 leading-relaxed">
        {renderMarkdown(line)}
      </p>
    );
  }
  if (trimmed.startsWith("↓") || trimmed.startsWith("-") || trimmed.startsWith("📉")) {
    return (
      <p key={lineIdx} className="text-[var(--gnome-red-3)] font-medium mb-1 leading-relaxed">
        {renderMarkdown(line)}
      </p>
    );
  }
  if (trimmed.startsWith("💡") || trimmed.startsWith("✅")) {
    return (
      <p key={lineIdx} className="text-[var(--color-primary)] font-medium mb-1 leading-relaxed">
        {renderMarkdown(line)}
      </p>
    );
  }
  if (trimmed.startsWith("⚠") || trimmed.startsWith("🚨")) {
    return (
      <p key={lineIdx} className="text-[var(--gnome-yellow-4)] font-medium mb-1 leading-relaxed">
        {renderMarkdown(line)}
      </p>
    );
  }

  if (trimmed.startsWith("## ") || trimmed.startsWith("### ") || trimmed.startsWith("#### ")) {
    const level = trimmed.startsWith("#### ")
      ? 4
      : trimmed.startsWith("### ")
      ? 3
      : trimmed.startsWith("## ")
      ? 2
      : 1;
    const text = trimmed.replace(/^#{1,4}\s*/, "");
    return (
      <p
        key={lineIdx}
        className={`font-semibold text-[var(--text-primary)] mb-2 ${
          level === 1 ? "text-lg" : level === 2 ? "text-base" : "text-sm"
        } leading-relaxed`}
      >
        {text}
      </p>
    );
  }

  if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
    const text = trimmed.slice(2);
    return (
      <p key={lineIdx} className="mb-1 pl-3 leading-relaxed">
        <span className="text-[var(--text-tertiary)] mr-2">•</span>
        {renderMarkdown(text)}
      </p>
    );
  }

  if (trimmed.match(/^\d+\.\s/)) {
    const num = trimmed.match(/^\d+/)?.[0] ?? "";
    const text = trimmed.replace(/^\d+\.\s/, "");
    return (
      <p key={lineIdx} className="mb-1 pl-3 leading-relaxed">
        <span className="text-[var(--text-tertiary)] mr-2">{num}.</span>
        {renderMarkdown(text)}
      </p>
    );
  }

  const boldMatch = trimmed.match(/^(.+?):(.*)$/);
  if (boldMatch && !trimmed.includes("**")) {
    return (
      <p key={lineIdx} className="mb-1 leading-relaxed">
        <span className="font-semibold text-[var(--text-primary)]">{boldMatch[1]}:</span>
        <span className="text-[var(--text-secondary)]">{boldMatch[2]}</span>
      </p>
    );
  }

  const usdMatch = line.match(/(u?s\$\d+[\d.,]*)/g);
  if (usdMatch) {
    const parts = line.split(/(\s*u?s\$\d+[\d.,]*\s*)/g);
    return (
      <p key={lineIdx} className="text-[var(--text-secondary)] mb-1 leading-relaxed">
        {parts.map((part, i) => {
          if (part.match(/u?s\$\d+[\d.,]*/)) {
            return (
              <span key={i} className="font-mono text-[var(--color-primary)]">
                {part}
              </span>
            );
          }
          return renderMarkdown(part);
        })}
      </p>
    );
  }

  const arsMoneyMatch = line.match(/(\$\d+[\d.,]*)/g);
  if (arsMoneyMatch) {
    const parts = line.split(/(\$\d+[\d.,]*)/g);
    return (
      <p key={lineIdx} className="text-[var(--text-secondary)] mb-1 leading-relaxed">
        {parts.map((part, i) => {
          if (part.match(/\$\d+[\d.,]*/)) {
            return (
              <span key={i} className="font-mono">
                {part}
              </span>
            );
          }
          return renderMarkdown(part);
        })}
      </p>
    );
  }

  const pctMatch = line.match(/(\d+[,.]?\d*%)/);
  if (pctMatch) {
    const parts = line.split(/(\d+[,.]?\d*%)/g);
    return (
      <p key={lineIdx} className="text-[var(--text-secondary)] mb-1 leading-relaxed">
        {parts.map((part, i) => {
          if (part.match(/\d+[,.]?\d*%/)) {
            const isPositive = !part.startsWith("-");
            return (
              <span
                key={i}
                className={isPositive ? "text-[var(--gnome-green-5)]" : "text-[var(--gnome-red-3)]"}
              >
                {part}
              </span>
            );
          }
          return renderMarkdown(part);
        })}
      </p>
    );
  }

  const tickerMatch = line.match(/\b([A-Z]{2,5})\b/g);
  if (tickerMatch && tickerMatch.length > 0) {
    const parts = line.split(/(\b[A-Z]{2,5}\b)/g);
    return (
      <p key={lineIdx} className="text-[var(--text-secondary)] mb-1 leading-relaxed">
        {parts.map((part, i) => {
          if (tickerMatch.includes(part)) {
            return (
              <span key={i} className="font-mono text-[var(--color-primary)] font-medium">
                {part}
              </span>
            );
          }
          return renderMarkdown(part);
        })}
      </p>
    );
  }

  if (trimmed.match(/\*\*/)) {
    return (
      <p key={lineIdx} className="text-[var(--text-secondary)] mb-1 leading-relaxed">
        {renderMarkdown(line)}
      </p>
    );
  }

  return (
    <p key={lineIdx} className="text-[var(--text-secondary)] mb-1 leading-relaxed">
      {line}
    </p>
  );
}

export function formatMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, lineIdx) => processLine(line, lineIdx));
}

export function formatAIResponse(text: string): React.ReactNode {
  return formatMarkdown(text);
}
