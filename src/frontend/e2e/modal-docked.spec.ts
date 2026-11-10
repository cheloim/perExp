import { expect, test } from "@playwright/test";
import { mockBackend, seedAuth } from "./helpers";

/**
 * Regression: the docked assistant is a root-level flex item with `z-50`,
 * while every modal mounted inside `<main>` — a `relative z-10` stacking
 * context. With a wide panel the detail dialog was painted underneath the
 * assistant and the backdrop never covered it.
 *
 * These assertions talk about what is actually on top at the dialog's own
 * pixels, not about CSS classes, so they survive a refactor of the overlay.
 */
const ROW = {
  id: 1,
  date: "01-10-2026",
  description: "Farmacia Central",
  amount: 1500,
  currency: "ARS",
  category_id: 1,
  category_name: "Salud",
  category_color: "#6366f1",
  card: "",
  bank: "",
  person: "",
  notes: "",
  tags: [],
  is_income: false,
};

const OVERRIDES = {
  "/expenses/stats": { total: 1500, count: 1, avg: 1500, last_used: null },
  "/categories": [{ id: 1, name: "Salud", color: "#6366f1", keywords: "" }],
  "/tags": [],
};

test.describe("modals with the docked assistant", () => {
  test.skip(({ isMobile }) => isMobile === true, "docking only applies on desktop");

  for (const width of [400, 720]) {
    test(`the expense dialog is on top of the ${width}px panel`, async ({ page }) => {
      await seedAuth(page, { drawerOpen: true });
      await page.addInitScript((w) => {
        window.localStorage.setItem("ai_drawer_mode", "docked");
        window.localStorage.setItem("ai_drawer_width", String(w));
      }, width);
      await mockBackend(page, OVERRIDES);
      await page.route(/\/api\/expenses(\?.*)?$/, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([ROW]),
        }),
      );

      await page.goto("/expenses");
      const firstRow = page.locator("tbody tr.group").first();
      await firstRow.waitFor({ timeout: 20_000 });
      await firstRow.click();

      const dialog = page.locator('[role="dialog"][aria-modal="true"]');
      await expect(dialog).toBeVisible();

      // Every point inside the dialog must hit the dialog, not the assistant.
      const hits = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"][aria-modal="true"]');
        const aside = document.querySelector('[data-testid="assistant-docked"]');
        if (!dlg || !aside) return null;
        const r = dlg.getBoundingClientRect();
        const a = aside.getBoundingClientRect();
        const points = [
          [r.right - 8, r.top + 8],
          [r.right - 8, r.top + r.height / 2],
          [r.left + r.width / 2, r.top + 8],
          // The panel's own center: with a modal open, the backdrop owns it.
          [a.left + a.width / 2, a.top + a.height / 2],
        ];
        return points.map(([x, y]) => {
          const el = document.elementFromPoint(x, y);
          if (!el) return "none";
          if (el.closest('[role="dialog"][aria-modal="true"]')) return "dialog";
          if (el.closest('[data-testid="assistant-docked"]')) return "assistant";
          return "backdrop";
        });
      });

      expect(hits).toEqual(["dialog", "dialog", "dialog", "backdrop"]);
    });
  }
});
