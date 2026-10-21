import { getDashboardAITrends } from "../../api/client";
import type { AssistantConfig, StreamArgs } from "./types";
import {
  ASSISTANT_HISTORY_CHARS,
  ASSISTANT_HISTORY_MESSAGES,
  ASSISTANT_OPEN_BUDGET_MS,
} from "./types";

/** Sentinel user-prompt posted when the user hits "Analizar gastos del mes". */
export const ANALYZE_PROMPT = "✨ Analizar gastos del mes";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Monthly trends analysis. This is NOT a chat call — it hits the trends
 * endpoint and formats a structured reply, which is why it lives behind
 * `analyzeSlot.run` instead of going through `useAssistantChat`.
 */
async function runMonthlyAnalysis(): Promise<string> {
  const data = await getDashboardAITrends({ month: currentMonth() });
  const trendIcon = data.trend === "up" ? "↑" : data.trend === "down" ? "↓" : "→";
  const trendLabel =
    data.trend === "up"
      ? "Tendencia alcista"
      : data.trend === "down"
        ? "Tendencia bajista"
        : "Estable";

  let text = `${trendIcon} ${trendLabel}\n\n${data.trend_explanation}`;
  if (data.top_rising_category) text += `\n\n↑ Subió: ${data.top_rising_category}`;
  if (data.top_falling_category) text += `\n\n↓ Bajó: ${data.top_falling_category}`;
  if (data.recommendation) text += `\n\n💡 ${data.recommendation}`;
  if (data.alert) text += `\n\n⚠ ${data.alert}`;
  return text;
}

/**
 * The thread as conversation turns.
 *
 * Two bounds, applied in this order: the number of turns the backend forwards,
 * and the size in characters. The browser keeps every message forever and the
 * request must not.
 *
 * Error bubbles and blanks are dropped before the window is cut, not after:
 * slicing first would let a "No pude procesar" placeholder eat a slot, and
 * handing it back to the model as a real reply teaches it to apologise at
 * random. `text` is read defensively because stored sessions predate this wire
 * format and are not validated on read.
 *
 * The window starts on a user turn. A thread is read as question/answer pairs,
 * so a leading orphan reply would be read as the model talking to itself.
 */
function wireMessages(
  history: StreamArgs["history"],
): { role: "user" | "assistant"; text: string }[] {
  const clean = history
    .filter((m) => !m.error && (m.text ?? "").trim() !== "")
    .map((m) => ({ role: m.role, text: m.text }));

  // Newest first, so both bounds stop as soon as the window is full.
  const kept: { role: "user" | "assistant"; text: string }[] = [];
  let chars = 0;
  for (let i = clean.length - 1; i >= 0; i--) {
    if (kept.length >= ASSISTANT_HISTORY_MESSAGES) break;
    const m = clean[i];
    if (kept.length > 0 && chars + m.text.length > ASSISTANT_HISTORY_CHARS) break;
    kept.unshift(m);
    chars += m.text.length;
  }

  const firstUser = kept.findIndex((m) => m.role === "user");
  return firstUser > 0 ? kept.slice(firstUser) : kept;
}

const SPENDING_CONFIG: AssistantConfig = {
  domain: "spending",
  title: "Asistente de Gastos",
  triggerLabel: "Asistente IA",
  placeholder: "Preguntá sobre tus gastos...",
  suggestions: [
    "¿Cuánto llevo gastado este mes?",
    "Compará con el mes pasado",
    "¿Dónde puedo recortar?",
    "¿Cómo voy contra el presupuesto?",
  ],
  analyzingLabel: "Analizando tus gastos…",
  followUps: ["Compará con el mes pasado", "¿Dónde más puedo recortar?", "Detallame por categoría"],
  streamUrl: "/api/analysis/stream",
  buildBody: (args: StreamArgs) => ({
    // The assistant analyses a window — the current month plus the two before
    // it — not a single month, so the thread can answer "¿cómo vengo?" style
    // questions. A caller that names a length gets that one instead.
    months: args.months ?? 3,
    question: args.question,
    debug_mode: args.debugMode ?? false,
    messages: wireMessages(args.history),
  }),
  analyzeSlot: {
    label: ANALYZE_PROMPT,
    prompt: ANALYZE_PROMPT,
    run: runMonthlyAnalysis,
  },
  rotateAfterIdleMinutes: 120,
  openBudgetMs: ASSISTANT_OPEN_BUDGET_MS,
};

const INVESTMENTS_CONFIG: AssistantConfig = {
  domain: "investments",
  title: "Asistente de Inversiones",
  triggerLabel: "Abrir Asistente de Inversiones",
  placeholder: "Preguntá sobre tus inversiones...",
  suggestions: [
    "¿Cómo viene mi cartera?",
    "¿Cómo voy contra la inflación?",
    "¿Dónde estoy más expuesto?",
    "Compará mis rendimientos",
  ],
  analyzingLabel: "Analizando tus inversiones…",
  followUps: ["Compará con el mes pasado", "Detallame por activo", "¿Cómo viene mi P&L?"],
  streamUrl: "/api/investments/chat/stream",
  buildBody: (args: StreamArgs) => ({
    question: args.question,
    context: args.context ?? "",
    messages: wireMessages(args.history),
  }),
  // No analyze slot: month analysis is a spending feature.
  rotateAfterIdleMinutes: 0,
  openBudgetMs: ASSISTANT_OPEN_BUDGET_MS,
};

export const ASSISTANT_CONFIGS = {
  spending: SPENDING_CONFIG,
  investments: INVESTMENTS_CONFIG,
};
