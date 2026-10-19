export type Role = "user" | "assistant";

export type AssistantDomain = "spending" | "investments";

export type Message = {
  role: Role;
  text: string;
  /** Present on messages written after the unification; absent on legacy ones. */
  domain?: AssistantDomain;
  /** Marks an error bubble instead of a real assistant reply. */
  error?: boolean;
};

/**
 * Field names are the legacy ones (`ts`, `lastMessageTs`, `summary`) so the
 * migration from `ai_assistant_*` / `inv_assistant_*` is lossless and the
 * existing history-tab and rotation semantics carry over unchanged.
 */
export type Session = {
  id: string;
  ts: number;
  lastMessageTs?: number;
  messages: Message[];
  summary?: string;
};

export type StorageKeys = { sessions: string; active: string };

/**
 * How long the assistant modal may take to open. Owned here — the one place
 * with no imports — so `configs.ts` (which documents the per-domain parity)
 * and `e2e/assistant-perf.spec.ts` (which enforces it) cannot drift apart.
 */
export const ASSISTANT_OPEN_BUDGET_MS = 300;

/**
 * How many prior turns travel with a request. The browser stores the whole
 * thread forever and the backend caps what it forwards, so this bounds the
 * request itself — a 5000-message thread would otherwise mean a multi-MB
 * upload and a full parse for every single question.
 */
export const ASSISTANT_HISTORY_MESSAGES = 20;

/**
 * The one shared, domain-agnostic store. The thread follows the user across
 * screens, so there is exactly one session list — the legacy per-domain keys
 * survive only as migration sources.
 */
export const SHARED_STORAGE: StorageKeys = {
  sessions: "assistant_sessions",
  active: "assistant_active",
};

/** Where `migrateLegacySessions` reads the pre-unification data from. */
export const LEGACY_STORAGE: Record<AssistantDomain, StorageKeys> = {
  spending: { sessions: "ai_assistant_sessions", active: "ai_assistant_active" },
  investments: {
    sessions: "inv_assistant_sessions",
    active: "inv_assistant_active",
  },
};

export type StreamArgs = {
  question: string;
  history: Message[];
  month?: string | null;
  debugMode?: boolean;
  context?: string;
};

export type AssistantConfig = {
  domain: AssistantDomain;
  title: string;
  triggerLabel: string;
  placeholder: string;
  suggestions: string[];
  /** Streaming status in the composer footer. Names the domain being analysed. */
  analyzingLabel: string;
  /** Chips offered after an assistant reply, in the thread's domain. */
  followUps: string[];
  streamUrl: string;
  buildBody: (args: StreamArgs) => Record<string, unknown>;
  /** Present when the domain offers a one-click analysis. `run` returns the reply text. */
  analyzeSlot?: { label: string; prompt: string; run: () => Promise<string> };
  rotateAfterIdleMinutes: number;
  openBudgetMs: number;
};
