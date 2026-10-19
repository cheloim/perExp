import { useCallback, useEffect, useRef, useState } from "react";
import { migrateLegacySessions } from "./migrateLegacySessions";
import { LEGACY_STORAGE, SHARED_STORAGE } from "./types";
import type { Session, StorageKeys } from "./types";

const MAX_SESSIONS = 30;

function readSessions(key: string): Session[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The legacy stores are merged before the very first read, or the seeded
 * history would not be in state on the render that follows. `migrateLegacySessions`
 * is idempotent, so this is safe on every mount.
 */
function ensureMigrated(storage: StorageKeys): void {
  if (storage.sessions !== SHARED_STORAGE.sessions) return;
  migrateLegacySessions(SHARED_STORAGE, LEGACY_STORAGE);
}

/** Drop a session from the legacy sources too, or the next mount re-merges it. */
function purgeLegacy(sessionId: string): void {
  for (const keys of Object.values(LEGACY_STORAGE)) {
    try {
      const kept = readSessions(keys.sessions).filter((s) => s.id !== sessionId);
      localStorage.setItem(keys.sessions, JSON.stringify(kept));
    } catch {
      /* ignore */
    }
  }
}

export function newSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function blankSession(): Session {
  const now = Date.now();
  return { id: newSessionId(), ts: now, messages: [] };
}

/** `Array.prototype.at` is unavailable at this repo's TS lib target. */
function lastOf<T>(items: T[]): T | undefined {
  return items.length ? items[items.length - 1] : undefined;
}

/**
 * Shared, domain-agnostic session store.
 *
 * There must be exactly ONE instance of this hook for the assistant: two would
 * keep independent state and the chrome would follow a frozen mount-time
 * snapshot instead of the live thread. `AssistantShell` owns the instance.
 *
 * In-memory state is authoritative: it is the only place message objects keep
 * their identity. Re-reading localStorage on every write would hand back freshly
 * parsed objects, which defeats `Bubble`'s memo and makes a streaming chunk
 * re-render the whole thread. Storage is a persistence side effect.
 */
export function useAssistantSessions(storage: StorageKeys) {
  const [sessions, setSessions] = useState<Session[]>(() => {
    ensureMigrated(storage);
    return readSessions(storage.sessions);
  });
  const [activeId, setActiveIdState] = useState<string>(
    () => localStorage.getItem(storage.active) || lastOf(readSessions(storage.sessions))?.id || "",
  );

  /** Latest sessions with stable object identity, readable synchronously. */
  const sessionsRef = useRef<Session[]>(sessions);
  sessionsRef.current = sessions;

  /**
   * The merge can legitimately produce more than MAX_SESSIONS (two legacy
   * stores of 30 each). Truncating to 30 on the first write would silently drop
   * half of a user's history, so the post-merge count is the floor.
   */
  const floorRef = useRef<number>(sessions.length);

  /** Persist as a side effect; the array passed in is what stays in state. */
  const commit = useCallback(
    (next: Session[]) => {
      const cap = Math.max(MAX_SESSIONS, floorRef.current);
      const capped = next.length > cap ? next.slice(-cap) : next;
      sessionsRef.current = capped;
      setSessions(capped);
      try {
        localStorage.setItem(storage.sessions, JSON.stringify(capped));
      } catch {
        /* quota exceeded: keep in-memory state rather than corrupting storage */
      }
    },
    [storage.sessions],
  );

  useEffect(() => {
    try {
      localStorage.setItem(storage.active, activeId);
    } catch {
      /* ignore */
    }
  }, [activeId, storage.active]);

  const createSession = useCallback((): string => {
    const s = blankSession();
    commit([...sessionsRef.current, s]);
    setActiveIdState(s.id);
    return s.id;
  }, [commit]);

  const setActiveId = useCallback((id: string) => setActiveIdState(id), []);

  const updateSession = useCallback(
    (id: string, fn: (s: Session) => Session) => {
      commit(sessionsRef.current.map((s) => (s.id === id ? fn(s) : s)));
    },
    [commit],
  );

  const deleteSession = useCallback(
    (id: string) => {
      const next = sessionsRef.current.filter((s) => s.id !== id);
      commit(next);
      purgeLegacy(id);
      setActiveIdState((prev) => (prev === id ? (lastOf(next)?.id ?? "") : prev));
    },
    [commit],
  );

  /**
   * Rotate to a fresh session when the active one has been idle past the
   * threshold. Returns the session id a new message should land in, so callers
   * never race the rotation. `idleMinutes <= 0` disables rotation for a surface
   * that has none.
   */
  const maybeRotate = useCallback(
    (idleMinutes: number): string => {
      const current = sessionsRef.current.find((s) => s.id === activeId);
      if (idleMinutes <= 0 || !current || current.messages.length === 0) {
        return activeId || createSession();
      }

      const lastTs = current.lastMessageTs ?? current.ts;
      const idleMs = Date.now() - lastTs;
      if (idleMs <= idleMinutes * 60 * 1000) return activeId;

      const fresh = blankSession();
      commit([...sessionsRef.current, fresh]);
      setActiveIdState(fresh.id);
      return fresh.id;
    },
    [activeId, commit, createSession],
  );

  const activeSession = sessions.find((s) => s.id === activeId);

  return {
    sessions,
    activeId,
    activeSession,
    createSession,
    setActiveId,
    updateSession,
    deleteSession,
    maybeRotate,
  };
}

export type AssistantStore = ReturnType<typeof useAssistantSessions>;
