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
 * A conversation as the pre-thread stores held it — the shape the migration
 * reads and all `domainOf` needs. `ts` breaks ties when picking the freshest
 * session to carry into the thread, and `id` is just what their records kept.
 * Everything else a session held (`lastMessageTs`, `summary`) went away with
 * the session model, and these survivors are optional because the thread has
 * no use for them.
 */
export type Session = {
  id?: string;
  ts?: number;
  messages: Message[];
};

/** The thread's persistence: one key holding `Message[]`. */
export type StorageKeys = { thread: string };

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
 *
 * A turn is a question and its reply, so the window is two messages per turn.
 * Counting turns rather than messages matters now that one thread crosses
 * domains: an error bubble or a blank reply must not eat half the window.
 */
export const ASSISTANT_HISTORY_TURNS = 20;

export const ASSISTANT_HISTORY_MESSAGES = ASSISTANT_HISTORY_TURNS * 2;

/**
 * Second, independent bound: long messages. 40 messages of 2000 characters
 * each is a multi-MB request; this keeps the window cheap even when the thread
 * is made of essays. Oldest turns go first, so the newest question always fits.
 */
export const ASSISTANT_HISTORY_CHARS = 16000;

/**
 * The one shared, domain-agnostic thread. It follows the user across screens,
 * so there is exactly one conversation — everything written before it survives
 * only as a migration source.
 */
export const SHARED_STORAGE: StorageKeys = {
  thread: "assistant_thread",
};

/** A pre-thread store: the `Session[]` list to read plus the pointer to purge. */
type LegacyKeys = { sessions: string; active: string };

/**
 * Every key written before `assistant_thread`, as the migration's key map: the
 * two per-domain stores from before the unification (`spending`, `investments`)
 * and the single-list store the thread replaces (`unified`). Sessions are read
 * from `sessions`, freshest by `ts`; `active` is only purged.
 */
export const LEGACY_STORAGE: Record<AssistantDomain | "unified", LegacyKeys> = {
  spending: { sessions: "ai_assistant_sessions", active: "ai_assistant_active" },
  investments: {
    sessions: "inv_assistant_sessions",
    active: "inv_assistant_active",
  },
  unified: { sessions: "assistant_sessions", active: "assistant_active" },
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
