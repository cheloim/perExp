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
 * is idempotent, so this is safe to call on every mount.
 */
function ensureMigrated(storage: StorageKeys): void {
  if (storage.sessions !== SHARED_STORAGE.sessions) return;
  migrateLegacySessions(SHARED_STORAGE, LEGACY_STORAGE);
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
 * In-memory state is authoritative: it is the only place message objects keep
 * their identity. Re-reading localStorage on every write would hand back
 * freshly parsed objects, which defeats `Bubble`'s memo and makes a streaming
 * chunk re-render the whole thread. Storage is a persistence side effect.
 *
 * The hook owns no timer: `maybeRotate()` is called by the consumer (on open
 * and before appending a message) and evaluates inactivity at that moment. Call
 * it *before* appending, or the new message lands in the session being rotated
 * out.
 */
export function useAssistantSessions(storage: StorageKeys, rotateAfterIdleMinutes: number) {
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

  /** Persist as a side effect; the array passed in is what stays in state. */
  const commit = useCallback(
    (next: Session[]) => {
      const capped = next.slice(-MAX_SESSIONS);
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
      setActiveIdState((prev) => (prev === id ? (lastOf(next)?.id ?? "") : prev));
    },
    [commit],
  );

  /**
   * Rotate to a fresh session when the active one has been idle past the
   * threshold. Returns the session id a new message should land in, so callers
   * never race the rotation.
   */
  const maybeRotate = useCallback((): string => {
    const current = sessionsRef.current.find((s) => s.id === activeId);
    if (rotateAfterIdleMinutes <= 0 || !current || current.messages.length === 0) {
      return activeId || createSession();
    }

    const lastTs = current.lastMessageTs ?? current.ts;
    const idleMs = Date.now() - lastTs;
    if (idleMs <= rotateAfterIdleMinutes * 60 * 1000) return activeId;

    const fresh = blankSession();
    commit([...sessionsRef.current, fresh]);
    setActiveIdState(fresh.id);
    return fresh.id;
  }, [rotateAfterIdleMinutes, activeId, commit, createSession]);

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
