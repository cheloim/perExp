import type { AssistantDomain, Session, StorageKeys } from "./types";

function readSessions(key: string): Session[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Merge the two legacy per-domain stores into one domain-agnostic session list.
 *
 * Messages are tagged with the domain of the store they came from. The source
 * keys are left untouched so the migration is reversible. Running this twice
 * must not duplicate sessions — sessions already present in `target` are skipped
 * by id.
 */
export function migrateLegacySessions(
  target: StorageKeys,
  sources: Record<AssistantDomain, StorageKeys>,
): void {
  const existing = readSessions(target.sessions);
  const seen = new Set(existing.map((s) => s.id));

  const migrated: Session[] = [];
  for (const domain of ["spending", "investments"] as const) {
    for (const session of readSessions(sources[domain].sessions)) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      migrated.push({
        ...session,
        messages: (session.messages ?? []).map((m) => ({ ...m, domain })),
      });
    }
  }

  const merged = [...existing, ...migrated].sort((a, b) => a.ts - b.ts);

  try {
    localStorage.setItem(target.sessions, JSON.stringify(merged));
  } catch {
    /* quota exceeded: keep the previous state rather than corrupting it */
  }
}
