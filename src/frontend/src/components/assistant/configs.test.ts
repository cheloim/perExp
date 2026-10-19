import { describe, it, expect } from "vitest";
import { ASSISTANT_CONFIGS } from "./configs";
import { ASSISTANT_HISTORY_MESSAGES, ASSISTANT_OPEN_BUDGET_MS, LEGACY_STORAGE } from "./types";
import type { Message, StreamArgs } from "./types";

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
      messages: [],
    });
  });

  it("is migrated from the legacy ai_assistant_* store", () => {
    expect(LEGACY_STORAGE.spending).toEqual({
      sessions: "ai_assistant_sessions",
      active: "ai_assistant_active",
    });
  });

  it("keeps the ANALYZE_PROMPT sentinel and its slot", () => {
    expect(cfg.analyzeSlot?.label).toBe("✨ Analizar gastos del mes");
    expect(cfg.analyzeSlot?.prompt).toBe("✨ Analizar gastos del mes");
    expect(typeof cfg.analyzeSlot?.run).toBe("function");
  });

  it("sends the whole thread as conversation turns, not just the question", () => {
    const withHistory: StreamArgs = {
      ...ARGS,
      history: [
        { role: "user", text: "¿cuánto gasté?", domain: "spending" },
        { role: "assistant", text: "$10.000", domain: "spending" },
        // An error bubble is not a reply — it must not enter the conversation.
        { role: "assistant", text: "No pude procesar la consulta.", error: true },
        { role: "assistant", text: "   ", domain: "spending" },
      ],
    };
    const expected = [
      { role: "user", text: "¿cuánto gasté?" },
      { role: "assistant", text: "$10.000" },
    ];
    expect(cfg.buildBody(withHistory).messages).toEqual(expected);
    // Both endpoints get the same thread — the backend is not domain-filtered.
    expect(ASSISTANT_CONFIGS.investments.buildBody(withHistory).messages).toEqual(expected);
    expect(cfg.buildBody(ARGS).messages).toEqual([]);
  });

  it("never sends more turns than the window the backend forwards", () => {
    const long: StreamArgs = {
      ...ARGS,
      history: Array.from({ length: 50 }, (_, i) => ({
        role: "user" as const,
        text: `turno ${i}`,
      })),
    };
    const sent = cfg.buildBody(long).messages as { text: string }[];

    // The browser keeps every message forever; the request must not.
    expect(sent).toHaveLength(ASSISTANT_HISTORY_MESSAGES);
    expect(sent[0].text).toBe(`turno ${50 - ASSISTANT_HISTORY_MESSAGES}`);
    expect(sent[sent.length - 1].text).toBe("turno 49");
  });

  it("survives a legacy message that has no text", () => {
    // Stored sessions predate the wire format and are not validated on read.
    // A missing field must drop the turn, not throw inside buildBody — a throw
    // there surfaces as a connection error and repeats on every send.
    const legacy = { role: "user" } as unknown as Message;
    const body = cfg.buildBody({ ...ARGS, history: [legacy, { role: "user", text: "hola" }] });

    expect(body.messages).toEqual([{ role: "user", text: "hola" }]);
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
      messages: [],
    });
  });

  it("is migrated from the legacy inv_assistant_* store", () => {
    expect(LEGACY_STORAGE.investments).toEqual({
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
    expect(ASSISTANT_CONFIGS.spending.title).not.toBe(ASSISTANT_CONFIGS.investments.title);
    expect(ASSISTANT_CONFIGS.spending.title).toBe("Asistente de Gastos");
    expect(ASSISTANT_CONFIGS.investments.title).toBe("Asistente de Inversiones");
  });

  it("share one open budget, owned where the perf spec enforces it", () => {
    expect(ASSISTANT_OPEN_BUDGET_MS).toBe(300);
    expect(ASSISTANT_CONFIGS.spending.openBudgetMs).toBe(ASSISTANT_OPEN_BUDGET_MS);
    expect(ASSISTANT_CONFIGS.investments.openBudgetMs).toBe(ASSISTANT_OPEN_BUDGET_MS);
  });

  it("carry the per-domain copy the shell renders", () => {
    expect(ASSISTANT_CONFIGS.spending.analyzingLabel).toBe("Analizando tus gastos…");
    expect(ASSISTANT_CONFIGS.investments.analyzingLabel).toBe("Analizando tus inversiones…");
    expect(ASSISTANT_CONFIGS.spending.followUps).not.toEqual(
      ASSISTANT_CONFIGS.investments.followUps,
    );
  });
});
