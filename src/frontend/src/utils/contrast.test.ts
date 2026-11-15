import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio } from "./contrast";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
function themeBlock(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*{([\\s\\S]*?)}`));
  if (!match) throw new Error(`Theme block not found: ${selector}`);
  const values: Record<string, string> = {};
  for (const line of match[1].split(";")) {
    const [rawKey, rawValue] = line.split(":");
    if (!rawKey || !rawValue) continue;
    const key = rawKey.trim();
    if (!key.startsWith("--")) continue;
    values[key] = rawValue.replace("!important", "").trim();
  }
  return values;
}

function expectAA(theme: string, selector: string) {
  const tokens = themeBlock(selector);
  const surface = tokens["--color-surface"];
  const pairs: [string, string][] = [
    ["--color-success-text", tokens["--color-success-text"]],
    ["--color-warning-text", tokens["--color-warning-text"]],
    ["--color-danger-text", tokens["--color-danger-text"]],
    ["--text-secondary", tokens["--text-secondary"]],
    ["--text-tertiary", tokens["--text-tertiary"]],
  ];
  for (const [name, color] of pairs) {
    expect(color, `${theme}: missing ${name}`).toBeTruthy();
    const ratio = contrastRatio(color, surface);
    expect(
      ratio,
      `${theme}: ${name} on --color-surface is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);
  }
}

describe("theme contrast", () => {
  it("keeps light-theme status and dim text at WCAG AA", () => {
    expectAA("light", ":root");
  });

  it("keeps dark-theme status and dim text at WCAG AA", () => {
    expectAA("dark", ".dark");
  });
});
