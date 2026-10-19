import { getDashboardAITrends } from "../../api/client";
import type { AssistantConfig, StreamArgs } from "./types";

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
  streamUrl: "/api/analysis/stream",
  buildBody: (args: StreamArgs) => ({
    month: args.month ?? null,
    question: args.question,
    debug_mode: args.debugMode ?? false,
  }),
  analyzeSlot: {
    label: ANALYZE_PROMPT,
    prompt: ANALYZE_PROMPT,
    run: runMonthlyAnalysis,
  },
  rotateAfterIdleMinutes: 120,
  openBudgetMs: 300,
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
  streamUrl: "/api/investments/chat/stream",
  buildBody: (args: StreamArgs) => ({
    question: args.question,
    context: args.context ?? "",
  }),
  // No analyze slot: month analysis is a spending feature.
  rotateAfterIdleMinutes: 0,
  openBudgetMs: 300,
};

export const ASSISTANT_CONFIGS = {
  spending: SPENDING_CONFIG,
  investments: INVESTMENTS_CONFIG,
};
