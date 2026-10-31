/**
 * Persisted layout of the assistant window.
 *
 * The drawer has two shapes: the floating modal it has always been, and a
 * side panel that shares the width with the page. The choice is device-local
 * chrome, not server state, so it lives in `localStorage` next to the
 * open/closed flag.
 */

export type AssistantMode = "modal" | "docked";

export const ASSISTANT_MODE_KEY = "ai_drawer_mode";
export const ASSISTANT_WIDTH_KEY = "ai_drawer_width";

export const DOCKED_WIDTH_DEFAULT = 400;
export const DOCKED_WIDTH_MIN = 320;
export const DOCKED_WIDTH_MAX = 720;
/** The panel never eats more than this share of the viewport. */
export const DOCKED_WIDTH_MAX_VIEWPORT_FRACTION = 0.55;

function currentViewportWidth(): number {
  return typeof window === "undefined" ? 1280 : window.innerWidth;
}

/**
 * The widest the panel may get on this viewport: the absolute cap, or 55% of
 * the screen, whichever is smaller. Never below the minimum, or a phone-sized
 * viewport would turn the clamp into an inverted range.
 */
export function dockedWidthMax(viewport: number = currentViewportWidth()): number {
  const ceiling = Math.floor(viewport * DOCKED_WIDTH_MAX_VIEWPORT_FRACTION);
  return Math.max(DOCKED_WIDTH_MIN, Math.min(DOCKED_WIDTH_MAX, ceiling));
}

/**
 * Clamp a preference to the absolute range only. The viewport-aware clamp is
 * for rendering and dragging; persisting that one would let a phone overwrite
 * the width the user chose on a desktop.
 */
export function clampStoredWidth(width: number): number {
  if (!Number.isFinite(width)) return DOCKED_WIDTH_DEFAULT;
  return Math.min(Math.max(Math.round(width), DOCKED_WIDTH_MIN), DOCKED_WIDTH_MAX);
}

export function clampDockedWidth(width: number, viewport: number = currentViewportWidth()): number {
  if (!Number.isFinite(width)) return DOCKED_WIDTH_DEFAULT;
  return Math.min(Math.max(Math.round(width), DOCKED_WIDTH_MIN), dockedWidthMax(viewport));
}

export function readDockedMode(): AssistantMode {
  try {
    return localStorage.getItem(ASSISTANT_MODE_KEY) === "docked" ? "docked" : "modal";
  } catch {
    return "modal";
  }
}

export function persistDockedMode(mode: AssistantMode): void {
  try {
    localStorage.setItem(ASSISTANT_MODE_KEY, mode);
  } catch {
    /* ignore — the panel still works for this session */
  }
}

export function readDockedWidth(): number {
  try {
    const raw = localStorage.getItem(ASSISTANT_WIDTH_KEY);
    if (raw === null) return DOCKED_WIDTH_DEFAULT;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampStoredWidth(parsed) : DOCKED_WIDTH_DEFAULT;
  } catch {
    return DOCKED_WIDTH_DEFAULT;
  }
}

export function persistDockedWidth(width: number): void {
  try {
    localStorage.setItem(ASSISTANT_WIDTH_KEY, String(clampStoredWidth(width)));
  } catch {
    /* ignore */
  }
}
