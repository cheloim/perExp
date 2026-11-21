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
  for (const declaration of match[1].matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+)/g)) {
    values[declaration[1]] = declaration[2].replace("!important", "").trim();
  }
  return values;
}

const TEXT_TOKENS = [
  "--color-success-text",
  "--color-warning-text",
  "--color-danger-text",
  "--text-primary",
  "--text-secondary",
  "--text-tertiary",
] as const;

// Every surface where text can land. A token that only clears AA on white is
// not enough: cards use --color-surface, the page uses --color-base, and the
// sidebar uses its own background.
const SURFACES = [
  "--color-surface",
  "--color-base",
  "--color-base-container",
  "--color-sidebar",
] as const;

function expectAA(theme: string, selector: string) {
  const tokens = themeBlock(selector);
  for (const surfaceToken of SURFACES) {
    const surface = tokens[surfaceToken];
    expect(surface, `${theme}: missing ${surfaceToken}`).toBeTruthy();
    for (const name of TEXT_TOKENS) {
      const color = tokens[name];
      expect(color, `${theme}: missing ${name}`).toBeTruthy();
      const ratio = contrastRatio(color, surface);
      expect(
        ratio,
        `${theme}: ${name} on ${surfaceToken} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
}

describe("theme contrast", () => {
  it("keeps light-theme text and status tokens at WCAG AA on every surface", () => {
    expectAA("light", ":root");
  });

  it("keeps dark-theme text and status tokens at WCAG AA on every surface", () => {
    expectAA("dark", ".dark");
  });

  it("gives every semantic status a text-safe variant", () => {
    for (const selector of [":root", ".dark"]) {
      const tokens = themeBlock(selector);
      for (const status of ["success", "warning", "danger"]) {
        expect(
          tokens[`--color-${status}-text`],
          `${selector}: missing --color-${status}-text`,
        ).toBeTruthy();
      }
    }
  });
});
