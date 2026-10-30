import type { Locator, Page } from "@playwright/test";
import { LEGACY_STORAGE, SHARED_STORAGE } from "../src/components/assistant/types";

/**
 * Network-layer backend stub.
 *
 * The assistant and dashboard fire ~15 GETs through the axios client, all
 * prefixed `/api`. Rather than standing up a seeded backend, every test calls
 * this first and we answer with the smallest shape each consumer can render.
 * The AI streaming endpoint is SSE, so it is stubbed separately per test.
 */

const token = "e2e-fake-token";

/**
 * Match only root-level backend paths.
 *
 * The naive glob "star-star /api/star-star" also matches Vite's own module
 * transforms under src/api/*.ts, which then get answered with JSON and the app
 * fails to boot ("Expected a JavaScript-or-Wasm module script").
 * So match the path exactly instead.
 */
const isBackendPath = (url: URL) => url.pathname === "/api" || url.pathname.startsWith("/api/");

/**
 * Per-endpoint defaults.
 *
 * A blanket `[]` is not enough: consumers like UserPanel call
 * `formatFullName(user.full_name)[0]`, which throws on undefined. So every
 * object-shaped endpoint the shell renders must be listed here.
 */
export const DEFAULT_MOCKS: Record<string, unknown> = {
  "/auth/me": {
    id: 1,
    full_name: "Doe, Ana",
    email: "ana@example.com",
    is_active: true,
    created_at: "2024-01-01T00:00:00Z",
    onboarding_completed: true,
    email_verified: true,
    is_admin: false,
    is_blocked: false,
    whats_new_dismissed_version: "999.0.0",
  },
  "/auth/me/telegram-key": { telegram_key: "abc123" },
  "/auth/me/telegram-status": { connected: false },
  "/groups/me": null,
  "/groups/my-invite-code": { invite_code: "ABCD-EFGH" },
  "/notifications/unread-count": { count: 0 },
  "/dashboard": { total: 0, expenses: [], categories: [] },
  "/scheduled-summary": { installments: [], manual: [] },
};

/** Route everything under /api so no request ever reaches the Vite proxy. */
export async function mockBackend(
  page: Page,
  overrides: Record<string, unknown> = {},
  delays: Record<string, number> = {},
) {
  const table = { ...DEFAULT_MOCKS, ...overrides };
  await page.route(isBackendPath, async (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname.replace(/^\/api/, "");
    const body = table[key];
    const delay = delays[key] ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    // Known object endpoints come from the table; anything else defaults to a
    // list, which is the safer of the two for query consumers.
    const payload = body !== undefined ? body : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload ?? null),
    });
  });
}

/**
 * Every key written before the single thread. Purged on every seed so the
 * assistant's one-time migration can never fire mid-test and pull in leftovers
 * from a previous run — pages in one context share localStorage.
 */
const STALE_KEYS = Object.values(LEGACY_STORAGE).flatMap((keys) => [keys.sessions, keys.active]);

/**
 * Seed auth so RequireAuth renders, plus the drawer flag the assistant reads.
 *
 * `thread` pre-populates the assistant conversation. It must be written from
 * an init script rather than page.evaluate, because init scripts re-run on
 * reload — a long-history test that seeds then reloads would otherwise have its
 * fixture wiped by the default empty thread.
 */
export async function seedAuth(
  page: Page,
  opts: {
    drawerOpen?: boolean;
    thread?: unknown[];
    /** Version this device remembers dismissing. Defaults to a never-matching one. */
    whatsNewDismissedVersion?: string;
  } = {},
) {
  await page.addInitScript(
    ({ token, drawerOpen, thread, threadKey, staleKeys, whatsNewDismissedVersion }) => {
      window.localStorage.setItem("auth_token", token);
      // Always set the flag explicitly. Pages in one context share
      // localStorage, so a previous run that opened the drawer would otherwise
      // leak ai_drawer_open=true into the next one and hide the FAB.
      window.localStorage.setItem("ai_drawer_open", JSON.stringify(drawerOpen));
      // The thread is always written, empty by default: an absent key would
      // trigger the one-time migration against stale keys from a previous run.
      window.localStorage.setItem(threadKey, JSON.stringify(thread ?? []));
      for (const key of staleKeys) window.localStorage.removeItem(key);
      window.localStorage.setItem("whats_new_dont_remind_version", whatsNewDismissedVersion);
    },
    {
      token,
      drawerOpen: opts.drawerOpen ?? false,
      thread: opts.thread,
      threadKey: SHARED_STORAGE.thread,
      staleKeys: STALE_KEYS,
      whatsNewDismissedVersion: opts.whatsNewDismissedVersion ?? "999.0.0",
    },
  );
}

/** Full-page helper: auth, stubbed API, then navigate. */
export async function openApp(
  page: Page,
  path = "/guide",
  opts: { drawerOpen?: boolean; thread?: unknown[] } = {},
) {
  await seedAuth(page, opts);
  await mockBackend(page);
  await page.goto(path);
}

/**
 * Open the assistant from whatever trigger the current viewport exposes.
 *
 * Desktop shows the AI FAB directly; mobile hides it behind the "+" speed dial
 * (SpeedDial renders `hidden md:flex` on the FABs and a separate menu on
 * small screens), so the two viewports need different click sequences.
 */
export async function openAssistant(page: Page) {
  const aiButton = page.getByRole("button", { name: "Abrir asistente IA" });
  const menuTrigger = page.getByRole("button", { name: "Abrir menú de acciones" });

  // isVisible() does not wait, so calling it right after navigation races the
  // app's first render and silently reports "not visible". Wait for whichever
  // trigger this viewport actually renders before choosing a path.
  const which = await Promise.race([
    aiButton
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => "fab" as const),
    menuTrigger.waitFor({ state: "visible", timeout: 15_000 }).then(() => "menu" as const),
  ]);

  if (which === "menu") await menuTrigger.click();
  await aiButton.first().click();
}

/**
 * The control that would reopen the assistant right now — the desktop FAB or,
 * on mobile, the "+" that expands the speed dial.
 */
export function reopenTrigger(page: Page) {
  return page
    .locator(
      'button[aria-label="Abrir asistente IA"]:visible, button[aria-label="Abrir menú de acciones"]:visible',
    )
    .first();
}

/** True when the current viewport is below the md breakpoint. */
export function isMobileViewport(page: Page) {
  const size = page.viewportSize();
  return !!size && size.width < 768;
}

/**
 * Put focus on a REAL focusable element outside the dialog.
 *
 * This is the state a keyboard user is actually in right after opening: the
 * trigger that opened the modal keeps focus until the component's own
 * autofocus runs ~100ms later, and in CI that window is wide enough to hit.
 *
 * Blurring to `document.body` is NOT equivalent, and that distinction is the
 * whole point: Shift+Tab from body lands on the document's last tabbable,
 * which in this app happens to be inside the dialog, so the trap's
 * outside-focus gap passes by accident.
 *
 * `anchor` picks which outside element receives focus, and it must match the
 * direction under test or the browser's own tab order decides the outcome:
 *
 * - `firstOutside` — the document's first tabbable. Its NEXT tabbable is
 *   outside (the dialog starts ~50 elements in), so plain Tab escapes.
 * - `beforeDialog` — the tabbable immediately preceding the dialog, i.e. the
 *   trigger area. Its PREVIOUS tabbable is outside, so Shift+Tab escapes.
 *
 * Throws when it cannot seed that state, so the precondition fails loudly
 * instead of silently degrading.
 */
export type OutsideAnchor = "firstOutside" | "beforeDialog";

export async function focusOutsideDialog(page: Page, anchor: OutsideAnchor) {
  const outcome = await page.evaluate((which) => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return "no-dialog";

    const visible = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.getClientRects().length > 0);

    const firstInside = visible.findIndex((el) => dlg.contains(el));
    const target =
      which === "beforeDialog"
        ? firstInside > 0
          ? visible[firstInside - 1]
          : undefined
        : visible.find((el) => !dlg.contains(el));

    if (!target) return "no-outside-focusable";

    target.focus();
    const ae = document.activeElement;
    return ae && ae !== document.body && !dlg.contains(ae) ? "focused-outside" : "focus-failed";
  }, anchor);

  if (outcome !== "focused-outside") {
    throw new Error(
      `focusOutsideDialog(${anchor}): could not seed focus outside the dialog (${outcome})`,
    );
  }
}

/**
 * Let a container's opening animations settle before scanning it with axe.
 *
 * Playwright's visibility check passes as soon as an opacity fade leaves 0, but
 * axe-core models ancestor opacity and flattens foreground colors against the
 * backdrop — so a scan taken mid-fade sees a lower-contrast palette than the
 * one the user actually ends up with. The 0.2s `modal-content-in` fade on the
 * assistant dialog produced exactly that: `color-contrast` violations that
 * disappear at α=1. Awaiting the animations' own `finished` promises waits out
 * the fade without an arbitrary sleep.
 *
 * The scan root is the target's PARENT on purpose: the modal backdrop
 * (`animate-modal-backdrop`) sits outside the dialog subtree but its opacity
 * still changes the computed colors inside it.
 *
 * The `iterations !== Infinity` filter is load-bearing. Infinite animations
 * (`animate-pulse` and friends) never finish, so awaiting their `finished`
 * hangs until the test times out. They are safe to skip: a loop has no "end
 * state" to settle to — every frame is already the steady state.
 */
export async function settleOpenAnimations(target: Locator) {
  await target.evaluate(async (el) => {
    const root: Element = el.parentElement ?? el;
    await Promise.all(
      root
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
}
