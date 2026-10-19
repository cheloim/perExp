import type { AssistantDomain } from "./types";

/**
 * Vocabulary router v1 — which domain's endpoint should answer this message.
 *
 * Deterministic and free. A router that cost an LLM round trip would be
 * slower than just answering, and would make the same sentence route
 * differently on different days.
 *
 * The score is the number of distinct domain terms the message contains. More
 * hits wins; anything else — no hits, or a tie — leaves the thread where it
 * is. That is the "keep the focus" rule: a stray word does not flip a thread,
 * and a topic from neither domain stays in the domain it landed in so the
 * prompt can decline it there.
 */
/**
 * Stems rather than full word forms, so one term covers a whole family —
 * "gast" matches gasto, gastos, gastado, gasté and gastar alike. A missing
 * verb form would silently fall through to the thread's domain instead.
 */
const TERMS: Record<AssistantDomain, string[]> = {
  spending: [
    "gast",
    "consum",
    "presupuest",
    "tarjet",
    "cuot",
    "categor",
    "ahorr",
    "recort",
    "factur",
    "extract",
    "debit",
    "ingres",
    "sueld",
    "salari",
    "deud",
  ],
  investments: [
    "carter",
    "inversion",
    "activo",
    "activos",
    "bono",
    "cedear",
    "fci",
    "fondo de inversion",
    "accion",
    "bolsa",
    "plazo fijo",
    "caucion",
    "dolar mep",
    "dolar ccl",
    "mep",
    "ccl",
    "rendimiento",
    "broker",
    "cotizacion",
    "ticker",
    "etf",
    "opcion",
    "dividendo",
    "renta fija",
    "renta variable",
    "portfolio",
    "tenencia",
    "valuacion",
    "soberano",
  ],
};

/** Lowercase and strip diacritics so "gasté", "Gasté" and "gaste" all match. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function routeDomain(text: string, fallback: AssistantDomain): AssistantDomain {
  const norm = normalize(text);
  if (!norm.trim()) return fallback;

  const score = (domain: AssistantDomain) =>
    TERMS[domain].reduce((hits, term) => hits + (norm.includes(term) ? 1 : 0), 0);

  const spending = score("spending");
  const investments = score("investments");
  if (spending === investments) return fallback;
  return spending > investments ? "spending" : "investments";
}
