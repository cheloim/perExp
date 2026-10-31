import { useCallback, useRef, useState } from "react";
import {
  clearAssistantStorage,
  isPersistedThreadExpired,
  isThreadPersistenceEnabled,
  markThreadSaved,
  setThreadPersistenceEnabled,
} from "./storage";
import { LEGACY_STORAGE, SHARED_STORAGE } from "./types";
import type { AssistantDomain, Message, Session } from "./types";

/**
 * Persistence caps: 200 messages or 256 KB of stored JSON, whichever comes
 * first. The oldest messages go — the newest exchange is the one the user is
 * looking at, and the request window is cut from the tail anyway.
 */
export const MAX_THREAD_MESSAGES = 200;
export const MAX_THREAD_BYTES = 256 * 1024;

function readArray<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function storedBytes(messages: Message[]): number {
  return new TextEncoder().encode(JSON.stringify(messages)).length;
}

/**
 * Cut the oldest messages so the persisted thread fits both caps. The newest
 * message always survives: a single exchange that alone breaks the byte budget
 * is worth more than an empty thread.
 */
export function trimThread(messages: Message[]): Message[] {
  let kept =
    messages.length > MAX_THREAD_MESSAGES ? messages.slice(-MAX_THREAD_MESSAGES) : messages;
  while (kept.length > 1 && storedBytes(kept) > MAX_THREAD_BYTES) kept = kept.slice(1);
  return kept;
}

/**
 * The one move to the single thread, run before the first read.
 *
 * When `assistant_thread` is missing but pre-thread stores are not, the
 * freshest conversation (by `ts`, whatever store it came from) becomes the
 * thread and every old key is purged — the `assistant_*` pair included, since
 * it is just as stale now.
 *
 * Idempotent by construction: once the thread key exists there is nothing left
 * to do, so running this on every mount is inert. `React.StrictMode`
 * double-invokes the initializer this hangs off, which is exactly why the
 * guard is the key's existence and not a flag.
 */
export function migrateToThread(): Message[] {
  const existing = localStorage.getItem(SHARED_STORAGE.thread);
  if (existing !== null) return readArray<Message>(SHARED_STORAGE.thread);

  let freshest: Session | undefined;
  let freshestDomain: AssistantDomain | undefined;
  for (const name of Object.keys(LEGACY_STORAGE) as (keyof typeof LEGACY_STORAGE)[]) {
    for (const session of readArray<Session>(LEGACY_STORAGE[name].sessions)) {
      if (!freshest || (session.ts ?? 0) > (freshest.ts ?? 0)) {
        freshest = session;
        freshestDomain = name === "unified" ? undefined : name;
      }
    }
  }

  // Messages written before the unification carry no domain; tagging them with
  // the store they came from is what keeps `domainOf` honest after the move.
  const messages = (freshest?.messages ?? []).map((m) =>
    freshestDomain ? { ...m, domain: freshestDomain } : m,
  );

  for (const keys of Object.values(LEGACY_STORAGE)) {
    localStorage.removeItem(keys.sessions);
    localStorage.removeItem(keys.active);
  }
  try {
    localStorage.setItem(SHARED_STORAGE.thread, JSON.stringify(messages));
    markThreadSaved();
  } catch {
    /* quota exceeded: the thread still lives in memory for this session */
  }
  return messages;
}

function loadThread(): Message[] {
  // Persistence is opt-in. With the preference off (the default) or an expired
  // TTL, purge any thread left by a previous session instead of loading it.
  if (!isThreadPersistenceEnabled() || isPersistedThreadExpired()) {
    clearAssistantStorage();
    return [];
  }
  return trimThread(migrateToThread());
}

/**
 * The one thread for the assistant.
 *
 * There must be exactly ONE instance of this hook: two would keep independent
 * state and the chrome would follow a frozen mount-time snapshot instead of
 * the live thread. `AssistantShell` owns the instance.
 *
 * In-memory state is authoritative: it is the only place message objects keep
 * their identity. Re-reading localStorage on every write would hand back freshly
 * parsed objects, which defeats `Bubble`'s memo and makes a streaming chunk
 * re-render the whole thread. Storage is a persistence side effect.
 */
export function useThread() {
  const [messages, setMessages] = useState<Message[]>(loadThread);
  const [persistEnabled, setPersistEnabledState] = useState<boolean>(isThreadPersistenceEnabled);

  /** Latest messages with stable object identity, readable synchronously. */
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  /** Persist as a side effect; the array passed in is what stays in state. */
  const commit = useCallback((next: Message[]) => {
    const trimmed = trimThread(next);
    messagesRef.current = trimmed;
    setMessages(trimmed);
    if (!isThreadPersistenceEnabled()) return;
    try {
      localStorage.setItem(SHARED_STORAGE.thread, JSON.stringify(trimmed));
      markThreadSaved();
    } catch {
      /* quota exceeded: keep in-memory state rather than corrupting storage */
    }
  }, []);

  const updateThread = useCallback(
    (fn: (msgs: Message[]) => Message[]) => commit(fn(messagesRef.current)),
    [commit],
  );

  const clearThread = useCallback(() => commit([]), [commit]);

  const setPersistenceEnabled = useCallback((enabled: boolean) => {
    setThreadPersistenceEnabled(enabled);
    setPersistEnabledState(enabled);
    if (!enabled) {
      messagesRef.current = [];
      setMessages([]);
      return;
    }
    if (messagesRef.current.length) {
      try {
        localStorage.setItem(SHARED_STORAGE.thread, JSON.stringify(messagesRef.current));
        markThreadSaved();
      } catch {
        /* quota exceeded: keep in-memory state */
      }
    }
  }, []);

  return { messages, updateThread, clearThread, persistEnabled, setPersistenceEnabled };
}

export type ThreadStore = ReturnType<typeof useThread>;
