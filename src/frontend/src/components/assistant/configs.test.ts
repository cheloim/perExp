import { describe, it, expect } from "vitest";
import { ASSISTANT_CONFIGS } from "./configs";
import type { StreamArgs } from "./types";

const ARGS: StreamArgs = {
  question: "¿cuánto gasté?",
  history: [],
  month: "2026-10",
  debugMode: false,
  context: "=== CARTERA ACTUAL ===\nARS: $1.000",
};

describe("ASSISTANT_CONFIGS.spending", () => {
  const cfg = ASSISTANT_CONFIGS.spending;

  it("targets /api/analysis/stream with { month, question, debug_mode }", () => {
    expect(cfg.streamUrl).toBe("/api/analysis/stream");
    expect(cfg.buildBody(ARGS)).toEqual({
      month: "2026-10",
      question: "¿cuánto gasté?",
      debug_mode: false,
    });
  });

  it("uses ai_assistant_sessions / ai_assistant_active", () => {
    expect(cfg.storage).toEqual({
      sessions: "ai_assistant_sessions",
      active: "ai_assistant_active",
    });
  });

  it("keeps the ANALYZE_PROMPT sentinel and its slot", () => {
    expect(cfg.analyzeSlot).toEqual({
      label: "✨ Analizar gastos del mes",
      prompt: "✨ Analizar gastos del mes",
    });
  });

  it("rotates sessions after 120 minutes", () => {
    expect(cfg.rotateAfterIdleMinutes).toBe(120);
  });

  it("has a 300ms open budget", () => {
    expect(cfg.openBudgetMs).toBe(300);
  });

  it("keeps the spending placeholder and the four spending suggestions", () => {
    expect(cfg.placeholder).toBe("Preguntá sobre tus gastos...");
    expect(cfg.suggestions).toEqual([
      "¿Cuánto llevo gastado este mes?",
      "Compará con el mes pasado",
      "¿Dónde puedo recortar?",
      "¿Cómo voy contra el presupuesto?",
    ]);
  });
});

describe("ASSISTANT_CONFIGS.investments", () => {
  const cfg = ASSISTANT_CONFIGS.investments;

  it("targets /api/investments/chat/stream with { question, context }", () => {
    expect(cfg.streamUrl).toBe("/api/investments/chat/stream");
    expect(cfg.buildBody(ARGS)).toEqual({
      question: "¿cuánto gasté?",
      context: "=== CARTERA ACTUAL ===\nARS: $1.000",
    });
  });

  it("uses inv_assistant_sessions / inv_assistant_active", () => {
    expect(cfg.storage).toEqual({
      sessions: "inv_assistant_sessions",
      active: "inv_assistant_active",
    });
  });

  it("has no analyze slot", () => {
    expect(cfg.analyzeSlot).toBeUndefined();
  });

  it("never rotates sessions", () => {
    expect(cfg.rotateAfterIdleMinutes).toBe(0);
  });

  it("has suggestions so both assistants share the same UI/UX", () => {
    expect(cfg.suggestions.length).toBeGreaterThan(0);
  });

  it("has a 300ms open budget", () => {
    expect(cfg.openBudgetMs).toBe(300);
  });

  it("keeps the investments placeholder", () => {
    expect(cfg.placeholder).toBe("Preguntá sobre tus inversiones...");
  });
});

describe("both configs", () => {
  it("keep the same UI geometry budget and distinct titles", () => {
    expect(ASSISTANT_CONFIGS.spending.openBudgetMs).toBe(
      ASSISTANT_CONFIGS.investments.openBudgetMs,
    );
    expect(ASSISTANT_CONFIGS.spending.title).not.toBe(
      ASSISTANT_CONFIGS.investments.title,
    );
    expect(ASSISTANT_CONFIGS.spending.title).toBe("Asistente de Gastos");
    expect(ASSISTANT_CONFIGS.investments.title).toBe("Asistente de Inversiones");
  });
});
