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
 *
 * Word forms that collide with ordinary Spanish will still misroute — "me
 * robaron la cartera", "la bolsa de trabajo", "el bono de la ANSES". That is
 * the price of a free router, and the cost is low: the other model answers a
 * question it can still answer. The misses that matter are the domain's own
 * verbs ("invertir") and its everyday assets ("el dólar"), which would send a
 * real question to the wrong prompt entirely — those are pinned in the tests.
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
  ],
  investments: [
    "carter",
    "inversion",
    "invert",
    "activo",
    "bono",
    "cedear",
    "fci",
    "fondo de inversion",
    "accion",
    "bolsa",
    "plazo fijo",
    "caucion",
    "dolar",
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
    "soberan",
    "merval",
    "byma",
    "nyse",
    "nasdaq",
    "reit",
    "comitente",
    "negociabl",
    "iol",
    "ppi",
  ],
};

/**
 * Word-start match, not substring: "ejemplo" must not match "mep", "violín"
 * must not match "iol", "accidente" is not "acción". Stems still work — "gast"
 * matches gasto, gastos, gastado and gasté alike, which is the point of
 * listing stems instead of word forms.
 */
const MATCHERS: Record<AssistantDomain, RegExp[]> = Object.fromEntries(
  (Object.keys(TERMS) as AssistantDomain[]).map((domain) => [
    domain,
    TERMS[domain].map((term) => new RegExp(`\\b${term}`)),
  ]),
) as Record<AssistantDomain, RegExp[]>;

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
    MATCHERS[domain].reduce((hits, matcher) => hits + (matcher.test(norm) ? 1 : 0), 0);

  const spending = score("spending");
  const investments = score("investments");
  if (spending === investments) return fallback;
  return spending > investments ? "spending" : "investments";
}
