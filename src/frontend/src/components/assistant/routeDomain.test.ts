import { describe, it, expect } from "vitest";
import { routeDomain } from "./routeDomain";

/**
 * The router decides which endpoint (and which LLM key) a message goes to,
 * from the words the user actually typed. Vocabulary rules only: no LLM call,
 * no latency, and the same input always routes the same way.
 */
describe("routeDomain", () => {
  it("routes a spending question to spending, whatever the thread was", () => {
    expect(routeDomain("¿cuánto llevo gastado este mes?", "investments")).toBe("spending");
    expect(routeDomain("no llego al presupuesto de supermercado", "investments")).toBe("spending");
    expect(routeDomain("¿en qué se me va la tarjeta de crédito?", "investments")).toBe("spending");
  });

  it("routes an investments question to investments, whatever the thread was", () => {
    expect(routeDomain("¿cómo viene mi cartera?", "spending")).toBe("investments");
    expect(routeDomain("compré CEDEARs de SPY, ¿cómo voy?", "spending")).toBe("investments");
    expect(routeDomain("¿qué rendimiento me dio el plazo fijo?", "spending")).toBe("investments");
  });

  it("stays put on a topic that is in neither domain", () => {
    // A recipe must not flip the thread's persona — it gets refused by the
    // prompt in the domain it landed in.
    expect(routeDomain("pasame una receta de ñoquis", "spending")).toBe("spending");
    expect(routeDomain("pasame una receta de ñoquis", "investments")).toBe("investments");
    expect(routeDomain("¿quién gana las elecciones?", "investments")).toBe("investments");
    expect(routeDomain("¿cómo hago un for en Python?", "spending")).toBe("spending");
  });

  it("stays put when both domains are equally present — the tie goes to the thread", () => {
    expect(routeDomain("¿cómo viene mi cartera y cuánto gasté este mes?", "investments")).toBe(
      "investments",
    );
    expect(routeDomain("¿cómo viene mi cartera y cuánto gasté este mes?", "spending")).toBe(
      "spending",
    );
  });

  it("matches words with or without accents and in any case", () => {
    expect(routeDomain("CÓMO VIENE MI CARTERA", "spending")).toBe("investments");
    expect(routeDomain("cuánto gasté en el super", "investments")).toBe("spending");
    expect(routeDomain("mis inversiones", "spending")).toBe("investments");
  });

  it("ignores an empty question and keeps the thread's domain", () => {
    expect(routeDomain("", "investments")).toBe("investments");
    expect(routeDomain("   ", "spending")).toBe("spending");
  });
});
