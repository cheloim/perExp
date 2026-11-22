import { expect, test, type Page } from "@playwright/test";
import { mockBackend, seedAuth } from "./helpers";
import { LATEST_VERSION } from "../src/data/changes";

/**
 * Network failures on the three core read screens. A 500 and a transport
 * timeout must both surface the shared error state, and Retry must recover
 * without a reload once the backend answers again.
 */

const DASHBOARD = {
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
  ],
  by_currency: [
    {
      currency: "ARS",
      total: 100_000,
      previous_total: 80_000,
      previous_mtd_total: 80_000,
    },
  ],
};

const BUDGET_SUMMARY = {
  month: "2026-11",
  currency: "ARS",
  fx_rate: null,
  fx_rate_date: null,
  fx_rate_source: null,
  total_budget: 300_000,
  total_spent: 120_000,
  total_percentage: 40,
  categories: [],
  trend_6m: [],
};

type Screen = {
  name: string;
  path: string;
  matcher: RegExp;
  successBody: unknown;
  heading: RegExp | string;
  overrides: Record<string, unknown>;
};

const SCREENS: Screen[] = [
  {
    name: "Dashboard",
    path: "/",
    matcher: /\/api\/dashboard\/summary(\?.*)?$/,
    successBody: DASHBOARD,
    heading: /oikonomia/i,
    overrides: {},
  },
  {
    name: "Gastos",
    path: "/expenses",
    matcher: /\/api\/expenses(\?.*)?$/,
    successBody: [],
    heading: "Gastos",
    overrides: {
      "/categories": [],
      "/tags": [],
      "/expenses/stats": { total: 0, count: 0, avg: 0, last_used: null },
    },
  },
  {
    name: "Presupuesto",
    path: "/budget",
    matcher: /\/api\/budgets\/summary(\?.*)?$/,
    successBody: BUDGET_SUMMARY,
    heading: "Presupuesto",
    overrides: {
      "/budgets/groups": [],
      "/budgets/events": [],
      "/budgets/config": { ahorro_enabled: true },
      "/budgets/suggest": { suggestions: [] },
    },
  },
];

type FailureMode = "500" | "timeout";

async function failUntilRecovered(
  page: Page,
  matcher: RegExp,
  mode: FailureMode,
  successBody: unknown,
) {
  let failing = true;
  await page.route(matcher, async (route) => {
    if (failing) {
      if (mode === "500") {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "e2e backend failure" }),
        });
      }
      return route.abort("timedout");
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(successBody),
    });
  });
  return () => {
    failing = false;
  };
}

test.describe("core screens survive network failures", () => {
  test.skip(({ isMobile }) => isMobile === true, "error states are viewport-independent");

  for (const mode of ["500", "timeout"] as const) {
    for (const screen of SCREENS) {
      test(`${screen.name}: ${mode} shows the error state and Retry recovers`, async ({ page }) => {
        await seedAuth(page, { whatsNewDismissedVersion: LATEST_VERSION });
        await mockBackend(page, screen.overrides);
        // Registered after mockBackend so this handler wins.
        const recover = await failUntilRecovered(page, screen.matcher, mode, screen.successBody);

        await page.goto(screen.path);

        const alert = page.getByRole("alert").filter({ hasText: /No pudimos cargar/ });
        await expect(alert).toBeVisible({ timeout: 20_000 });
        await expect(alert.getByRole("button", { name: "Reintentar" })).toBeVisible();

        recover();
        // The collapsed sidebar expands on hover and can cover controls near
        // the left edge, so recovery is driven from the keyboard.
        const retry = page.getByRole("button", { name: "Reintentar" });
        await retry.focus();
        await page.keyboard.press("Enter");

        await expect(alert).toBeHidden({ timeout: 20_000 });
        await expect(
          page.getByRole("heading", {
            name: screen.heading,
            exact: typeof screen.heading === "string",
          }),
        ).toBeVisible({ timeout: 20_000 });
      });
    }
  }
});
