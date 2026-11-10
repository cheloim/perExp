import { expect, test } from "@playwright/test";
import { mockBackend, seedAuth } from "./helpers";

/**
 * Regression: docking the assistant narrows the page column, but Tailwind's
 * `lg:` breakpoints still see the full viewport. The dashboard used to keep its
 * two-column grid and its chart/legend row, squeezing the donut container to
 * 157px, 97px and finally 0px while the Pie kept a fixed 190px radius. The
 * chart then clipped into the legend or disappeared entirely.
 *
 * The fixtures below are the smallest shape that renders the donut, so the
 * assertions talk about layout only.
 */
const DASHBOARD_WITH_CATEGORIES = {
  total_amount: 100_000,
  total_expenses: 2,
  is_current_month: true,
  mtd_cutoff_day: 2,
  previous_mtd_total: 80_000,
  by_category: [
    {
      category_id: 1,
      category_name: "Supermercado",
      category_color: "#3584e4",
      total: 60_000,
      previous_total: 50_000,
    },
    {
      category_id: 2,
      category_name: "Transporte",
      category_color: "#33d17a",
      total: 40_000,
      previous_total: 30_000,
    },
  ],
};

test.describe("dashboard layout with the docked assistant", () => {
  test.skip(({ isMobile }) => isMobile === true, "docking only applies on desktop");

  for (const width of [400, 520, 720]) {
    test(`keeps the category donut inside its card at ${width}px`, async ({ page }) => {
      await seedAuth(page, { drawerOpen: true, assistantMode: "docked", assistantWidth: width });
      await mockBackend(page, {
        "/dashboard/summary": DASHBOARD_WITH_CATEGORIES,
        // The dashboard shell assumes these object shapes; the helper's
        // fallback is a bare list, which would crash on `.installments`.
        "/dashboard/scheduled-summary": { installments: [], manual: [] },
        "/dashboard/credit-card-pasivos": { total_pasivos: 0, count: 0, pasivos: [] },
        "/investments/usd-rate": { rate: 1000, date: "2026-11-01", source: "e2e" },
        "/dashboard/tag-summary": [],
        "/dashboard/installments/monthly-load": [],
        "/dashboard/top-merchants": [],
        "/expenses/uncategorized-count": { count: 0 },
      });
      await page.goto("/");

      const card = page.locator(".card").filter({ hasText: "Gastos por Categoría" }).first();
      await expect(card).toBeVisible({ timeout: 20_000 });

      const chart = card.locator(".recharts-wrapper");
      await expect(chart).toBeVisible();

      const cardBox = await card.boundingBox();
      const chartBox = await chart.boundingBox();
      const pieBox = await card.locator(".recharts-pie").boundingBox();
      expect(cardBox).not.toBeNull();
      expect(chartBox).not.toBeNull();
      expect(pieBox).not.toBeNull();
      if (!cardBox || !chartBox || !pieBox) return;

      // The wrapper has to keep a usable width; zero was the "chart vanished" case.
      expect(chartBox.width).toBeGreaterThan(120);
      // The fixed 190px radius used to overflow the shrunken wrapper.
      expect(pieBox.width).toBeLessThanOrEqual(chartBox.width + 1);
      // And the whole graphic has to stay inside the card's padding box.
      expect(chartBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      expect(chartBox.x + chartBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);

      // No horizontal scrollbar in the content column.
      const overflow = await page.locator("main").evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    });
  }
});
