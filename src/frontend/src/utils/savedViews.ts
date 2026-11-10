/**
 * Named filter sets, stored per browser.
 *
 * Local-first on purpose: the shape is a serialized search string, so it can
 * move behind a `saved_views` API later without changing the UI contract.
 */

export const SAVED_VIEWS_KEY = "expenses_saved_views";
export const MAX_SAVED_VIEWS = 10;
export const MAX_VIEW_NAME = 40;

export interface SavedView {
  id: string;
  name: string;
  /** Serialized URLSearchParams, without transient params. */
  params: string;
  createdAt: number;
}

function sanitize(params: string): string {
  const parsed = new URLSearchParams(params);
  parsed.delete("category_suggestions");
  return parsed.toString();
}

function isSavedView(value: unknown): value is SavedView {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedView>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.params === "string" &&
    typeof candidate.createdAt === "number"
  );
}

export function readSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedView).slice(0, MAX_SAVED_VIEWS);
  } catch {
    return [];
  }
}

export function persistSavedViews(views: SavedView[]): void {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views.slice(0, MAX_SAVED_VIEWS)));
  } catch {
    /* private mode or quota: the views still work for this page view */
  }
}

export function buildSavedView(
  name: string,
  params: string,
  now: number = Date.now(),
): SavedView | null {
  const trimmed = name.trim().slice(0, MAX_VIEW_NAME);
  const clean = sanitize(params);
  if (!trimmed || !clean) return null;
  return {
    id: `${now}-${trimmed.toLowerCase().replace(/\s+/g, "-")}`,
    name: trimmed,
    params: clean,
    createdAt: now,
  };
}

/** Newest first; a name that already exists is replaced, not duplicated. */
export function addSavedView(views: SavedView[], view: SavedView): SavedView[] {
  const withoutSameName = views.filter(
    (existing) => existing.name.toLowerCase() !== view.name.toLowerCase(),
  );
  return [view, ...withoutSameName].slice(0, MAX_SAVED_VIEWS);
}

export function removeSavedView(views: SavedView[], id: string): SavedView[] {
  return views.filter((view) => view.id !== id);
}
