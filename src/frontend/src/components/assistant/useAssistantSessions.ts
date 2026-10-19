import { useCallback, useEffect, useState } from "react";
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
 * The hook owns no timer: `maybeRotate()` is called by the consumer (on open and
 * before appending a message) and evaluates inactivity at that moment. Call it
 * *before* appending, or the new message lands in the session being rotated out.
 */
export function useAssistantSessions(
  storage: StorageKeys,
  rotateAfterIdleMinutes: number,
) {
  const [sessions, setSessions] = useState<Session[]>(() =>
    readSessions(storage.sessions),
  );
  const [activeId, setActiveIdState] = useState<string>(
    () =>
      localStorage.getItem(storage.active) ||
      lastOf(readSessions(storage.sessions))?.id ||
      "",
  );

  const persist = useCallback(
    (next: Session[]) => {
      const capped = next.slice(-MAX_SESSIONS);
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
    persist([...readSessions(storage.sessions), s]);
    setActiveIdState(s.id);
    return s.id;
  }, [persist, storage.sessions]);

  const setActiveId = useCallback((id: string) => setActiveIdState(id), []);

  const updateSession = useCallback(
    (id: string, fn: (s: Session) => Session) => {
      const next = readSessions(storage.sessions).map((s) =>
        s.id === id ? fn(s) : s,
      );
      persist(next);
    },
    [persist, storage.sessions],
  );

  const deleteSession = useCallback(
    (id: string) => {
      const next = readSessions(storage.sessions).filter((s) => s.id !== id);
      persist(next);
      if (activeId === id) setActiveIdState(lastOf(next)?.id ?? "");
    },
    [persist, storage.sessions, activeId],
  );

  /**
   * Rotate to a fresh session when the active one has been idle past the
   * threshold. Returns the session id a new message should land in, so callers
   * never race the rotation.
   */
  const maybeRotate = useCallback((): string => {
    const current = readSessions(storage.sessions).find((s) => s.id === activeId);
    if (rotateAfterIdleMinutes <= 0 || !current || current.messages.length === 0) {
      return activeId || createSession();
    }

    const lastTs = current.lastMessageTs ?? current.ts;
    const idleMs = Date.now() - lastTs;
    if (idleMs <= rotateAfterIdleMinutes * 60 * 1000) return activeId;

    const fresh = blankSession();
    persist([...readSessions(storage.sessions), fresh]);
    setActiveIdState(fresh.id);
    return fresh.id;
  }, [rotateAfterIdleMinutes, storage.sessions, activeId, persist, createSession]);

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
