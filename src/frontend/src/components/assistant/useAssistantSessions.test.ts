import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { migrateLegacySessions } from "./migrateLegacySessions";
import { useAssistantSessions } from "./useAssistantSessions";
import type { AssistantDomain, Session, StorageKeys } from "./types";

const TARGET: StorageKeys = {
  sessions: "assistant_sessions",
  active: "assistant_active",
};

const SOURCES: Record<AssistantDomain, StorageKeys> = {
  spending: {
    sessions: "ai_assistant_sessions",
    active: "ai_assistant_active",
  },
  investments: {
    sessions: "inv_assistant_sessions",
    active: "inv_assistant_active",
  },
};

/** Legacy shape as stored today — no `domain`, `ts` instead of a message timestamp. */
function legacySession(id: string, ts: number, texts: string[]): Record<string, unknown> {
  return {
    id,
    ts,
    lastMessageTs: ts,
    messages: texts.map((text, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text,
    })),
  };
}

describe("migrateLegacySessions", () => {
  beforeEach(() => localStorage.clear());

  it("merges both legacy stores into one session list ordered by first message", () => {
    localStorage.setItem(
      SOURCES.spending.sessions,
      JSON.stringify([legacySession("spend-old", 1000, ["gasto viejo"])]),
    );
    localStorage.setItem(
      SOURCES.investments.sessions,
      JSON.stringify([
        legacySession("inv-new", 3000, ["inversión nueva"]),
        legacySession("inv-mid", 2000, ["inversión del medio"]),
      ]),
    );

    migrateLegacySessions(TARGET, SOURCES);

    const merged = JSON.parse(localStorage.getItem(TARGET.sessions)!);
    expect(merged.map((s: { id: string }) => s.id)).toEqual(["spend-old", "inv-mid", "inv-new"]);
  });

  it("tags every migrated message with its source domain", () => {
    localStorage.setItem(
      SOURCES.spending.sessions,
      JSON.stringify([legacySession("s1", 1000, ["gasto", "respuesta"])]),
    );
    localStorage.setItem(
      SOURCES.investments.sessions,
      JSON.stringify([legacySession("i1", 2000, ["cartera", "respuesta"])]),
    );

    migrateLegacySessions(TARGET, SOURCES);

    const merged = JSON.parse(localStorage.getItem(TARGET.sessions)!);
    const spend = merged.find((s: { id: string }) => s.id === "s1");
    const inv = merged.find((s: { id: string }) => s.id === "i1");

    expect(spend.messages.map((m: { domain: string }) => m.domain)).toEqual([
      "spending",
      "spending",
    ]);
    expect(inv.messages.map((m: { domain: string }) => m.domain)).toEqual([
      "investments",
      "investments",
    ]);
  });

  it("is idempotent: running twice does not duplicate sessions", () => {
    localStorage.setItem(
      SOURCES.spending.sessions,
      JSON.stringify([legacySession("s1", 1000, ["gasto"])]),
    );
    localStorage.setItem(
      SOURCES.investments.sessions,
      JSON.stringify([legacySession("i1", 2000, ["cartera"])]),
    );

    migrateLegacySessions(TARGET, SOURCES);
    migrateLegacySessions(TARGET, SOURCES);

    const merged = JSON.parse(localStorage.getItem(TARGET.sessions)!);
    expect(merged).toHaveLength(2);
  });

  it("preserves every session from both sources", () => {
    localStorage.setItem(
      SOURCES.spending.sessions,
      JSON.stringify([legacySession("s1", 1000, ["uno"]), legacySession("s2", 1500, ["dos"])]),
    );
    localStorage.setItem(
      SOURCES.investments.sessions,
      JSON.stringify([
        legacySession("i1", 2000, ["tres"]),
        legacySession("i2", 2500, ["cuatro"]),
        legacySession("i3", 3000, ["cinco"]),
      ]),
    );

    migrateLegacySessions(TARGET, SOURCES);

    const merged = JSON.parse(localStorage.getItem(TARGET.sessions)!);
    expect(merged).toHaveLength(5);
    expect(merged.map((s: { id: string }) => s.id).sort()).toEqual(["i1", "i2", "i3", "s1", "s2"]);
  });

  it("keeps the summary and timestamps so nothing user-visible is lost", () => {
    localStorage.setItem(
      SOURCES.spending.sessions,
      JSON.stringify([
        {
          id: "s1",
          ts: 1000,
          lastMessageTs: 1200,
          summary: "Resumen previo",
          messages: [{ role: "user", text: "hola" }],
        },
      ]),
    );

    migrateLegacySessions(TARGET, SOURCES);

    const merged = JSON.parse(localStorage.getItem(TARGET.sessions)!);
    expect(merged[0]).toMatchObject({
      id: "s1",
      ts: 1000,
      lastMessageTs: 1200,
      summary: "Resumen previo",
    });
  });
});

function seedSession(storage: StorageKeys, id: string, lastMessageTs: number): void {
  const session: Session = {
    id,
    ts: lastMessageTs,
    lastMessageTs,
    messages: [{ role: "user", text: "hola" }],
  };
  localStorage.setItem(storage.sessions, JSON.stringify([session]));
  localStorage.setItem(storage.active, id);
}

describe("useAssistantSessions", () => {
  const storage: StorageKeys = {
    sessions: "assistant_sessions",
    active: "assistant_active",
  };

  beforeEach(() => localStorage.clear());

  it("creates a session and makes it active", () => {
    const { result } = renderHook(() => useAssistantSessions(storage));

    let id = "";
    act(() => {
      id = result.current.createSession();
    });

    expect(id).toBeTruthy();
    expect(result.current.activeId).toBe(id);
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.activeSession?.id).toBe(id);
  });

  it("persists sessions to the configured storage keys", () => {
    const { result } = renderHook(() => useAssistantSessions(storage));

    act(() => {
      result.current.createSession();
    });

    const stored = JSON.parse(localStorage.getItem(storage.sessions)!);
    expect(stored).toHaveLength(1);
    expect(localStorage.getItem(storage.active)).toBe(result.current.activeId);
  });

  it("rotates to a fresh session after rotateAfterIdleMinutes of inactivity", () => {
    const stale = Date.now() - 3 * 60 * 60 * 1000; // 3h ago
    seedSession(storage, "stale", stale);

    const { result } = renderHook(() => useAssistantSessions(storage));

    expect(result.current.activeId).toBe("stale");
    act(() => {
      result.current.maybeRotate(120);
    });

    expect(result.current.activeId).not.toBe("stale");
    expect(result.current.sessions).toHaveLength(2);
  });

  it("never rotates when the idle threshold is 0", () => {
    const stale = Date.now() - 30 * 24 * 60 * 60 * 1000;
    seedSession(storage, "stale", stale);

    const { result } = renderHook(() => useAssistantSessions(storage));

    act(() => {
      result.current.maybeRotate(0);
    });

    expect(result.current.activeId).toBe("stale");
    expect(result.current.sessions).toHaveLength(1);
  });

  it("caps retained sessions at 30", () => {
    const { result } = renderHook(() => useAssistantSessions(storage));

    act(() => {
      for (let i = 0; i < 35; i++) result.current.createSession();
    });

    expect(result.current.sessions).toHaveLength(30);
  });

  it("a deleted session stays deleted across a remount", () => {
    localStorage.setItem(
      "ai_assistant_sessions",
      JSON.stringify([
        {
          id: "s1",
          ts: 1000,
          messages: [{ role: "user", text: "gasto" }],
        },
      ]),
    );

    const first = renderHook(() => useAssistantSessions(storage));
    act(() => {
      first.result.current.deleteSession("s1");
    });
    first.unmount();

    // A fresh mount runs the migration again; the deletion must survive it
    // rather than the legacy source resurrecting the session.
    const second = renderHook(() => useAssistantSessions(storage));
    expect(second.result.current.sessions.map((s) => s.id)).not.toContain("s1");
  });

  it("does not truncate a merged history that is larger than the cap", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`,
      ts: 1000 + i,
      messages: [{ role: "user", text: `m${i}` }],
    }));
    localStorage.setItem("ai_assistant_sessions", JSON.stringify(many.slice(0, 12)));
    localStorage.setItem("inv_assistant_sessions", JSON.stringify(many.slice(12)));

    const { result } = renderHook(() => useAssistantSessions(storage));
    expect(result.current.sessions).toHaveLength(25);

    // The next write must not silently drop the half that came from the merge.
    act(() => {
      result.current.createSession();
    });
    expect(result.current.sessions).toHaveLength(26);
  });
});
