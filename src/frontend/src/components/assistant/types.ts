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
  storage: StorageKeys;
  streamUrl: string;
  buildBody: (args: StreamArgs) => Record<string, unknown>;
  analyzeSlot?: { label: string; prompt: string };
  rotateAfterIdleMinutes: number;
  openBudgetMs: number;
};
