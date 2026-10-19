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

  it("routes the domain's own verbs and its everyday assets", () => {
    // The misses that matter most: a real question that used to reach the
    // other model, answered with the other data and billed to the other key.
    expect(routeDomain("¿en qué me conviene invertir?", "spending")).toBe("investments");
    expect(routeDomain("quiero invertir en la bolsa", "spending")).toBe("investments");
    expect(routeDomain("¿está caro el dólar?", "spending")).toBe("investments");
    expect(routeDomain("¿cómo viene el Merval?", "spending")).toBe("investments");
    expect(routeDomain("compré obligaciones negociables de YPF", "spending")).toBe("investments");
    expect(routeDomain("¿cómo está la deuda soberana?", "spending")).toBe("investments");
    expect(routeDomain("ingresé 200 dólares a IOL", "spending")).toBe("investments");
  });

  it("matches a term at the start of a word, never inside one", () => {
    // "violín" contains "iol", the IOL broker handle; "ejemplo" contains "mep".
    expect(routeDomain("¿cuánto salió el violín?", "spending")).toBe("spending");
    expect(routeDomain("no entiendo este ejemplo", "spending")).toBe("spending");
    // …while a stem still covers its whole word family.
    expect(routeDomain("gasté, gastado y por gastar", "investments")).toBe("spending");
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

  it("does not route on ordinary Spanish that shares a word with a domain", () => {
    // The three that used to flip a thread on their own.
    expect(routeDomain("me robaron la cartera en el subte", "spending")).toBe("spending");
    expect(routeDomain("¿encontraste la bolsa de trabajo?", "spending")).toBe("spending");
    expect(routeDomain("el bono de la ANSES me llegó ayer", "spending")).toBe("spending");
    // …and the rest of the same family.
    expect(routeDomain("celebramos la acción de gracias en familia", "investments")).toBe(
      "investments",
    );
    expect(routeDomain("es una opción múltiple", "spending")).toBe("spending");
    expect(routeDomain("voy a accionar el freno", "spending")).toBe("spending");
    expect(routeDomain("el presupuesto nacional subió", "investments")).toBe("investments");
    expect(routeDomain("tenencia de armas", "spending")).toBe("spending");
  });

  it("still routes the real question when one of those words is in it too", () => {
    // The exclusion is a phrase, not a word: "gasté" still counts here.
    expect(routeDomain("gasté mucho en la bolsa de trabajo", "investments")).toBe("spending");
    // And a bare "bolsa" or "bono" is still the financial one.
    expect(routeDomain("invertir en la bolsa", "spending")).toBe("investments");
    expect(routeDomain("compré bonos del tesoro", "spending")).toBe("investments");
  });
});
