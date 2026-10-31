import { LEGACY_STORAGE, SHARED_STORAGE } from "./types";

/**
 * The assistant thread contains amounts, categories and debt. It is persisted
 * only when the user explicitly opts in, and it expires after a short TTL.
 * Logout always wipes it, whatever the preference says.
 */
export const THREAD_PERSISTENCE_KEY = "assistant_persist_thread";
export const THREAD_TIMESTAMP_KEY = "assistant_thread_saved_at";
export const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function isThreadPersistenceEnabled(): boolean {
  try {
    return localStorage.getItem(THREAD_PERSISTENCE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setThreadPersistenceEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(THREAD_PERSISTENCE_KEY, enabled ? "true" : "false");
  } catch {
    /* storage unavailable: stay in memory */
  }
  if (!enabled) clearAssistantStorage();
}

/** Remove every assistant key that can contain financial data. */
export function clearAssistantStorage(): void {
  try {
    localStorage.removeItem(SHARED_STORAGE.thread);
    localStorage.removeItem(THREAD_TIMESTAMP_KEY);
    for (const keys of Object.values(LEGACY_STORAGE)) {
      localStorage.removeItem(keys.sessions);
      localStorage.removeItem(keys.active);
    }
  } catch {
    /* ignore unavailable storage */
  }
}

export function isPersistedThreadExpired(now = Date.now()): boolean {
  try {
    // With no persisted thread there is nothing to expire; legacy stores may
    // still exist and the migration needs a chance to run.
    if (localStorage.getItem(SHARED_STORAGE.thread) === null) return false;
    const savedAt = Number(localStorage.getItem(THREAD_TIMESTAMP_KEY) || "0");
    return !savedAt || now - savedAt > THREAD_TTL_MS;
  } catch {
    return true;
  }
}

export function markThreadSaved(now = Date.now()): void {
  try {
    localStorage.setItem(THREAD_TIMESTAMP_KEY, String(now));
  } catch {
    /* ignore unavailable storage */
  }
}
