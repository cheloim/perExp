import { expect, test } from "@playwright/test";
import { mockBackend, seedAuth } from "./helpers";

/**
 * The access token is short-lived now; the session lives in the rotating
 * refresh cookie. These tests drive the axios interceptor end to end: a 401
 * must trigger exactly one refresh (even when two requests fail together)
 * and replay the original request with the new token.
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
  "/categories": [{ id: 1, name: "Salud", color: "#6366f1", keywords: "" }],
  "/tags": [],
};

test.describe("silent refresh on 401", () => {
  test.skip(({ isMobile }) => isMobile === true, "the desktop table is enough here");

  test("one rotation replays every failed request with the new token", async ({ page }) => {
    await seedAuth(page);
    await mockBackend(page, OVERRIDES);

    let refreshCalls = 0;
    let expiredCalls = 0;
    const authHeaders: string[] = [];

    await page.route("**/api/auth/refresh", (route) => {
      refreshCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ access_token: "fresh-token", token_type: "bearer" }),
      });
    });

    // Both list and stats fail together: a dashboard-style burst.
    await page.route(/\/api\/expenses(\/stats)?(\?.*)?$/, (route) => {
      const url = new URL(route.request().url());
      const auth = route.request().headers().authorization;
      if (auth) authHeaders.push(auth);
      const isStats = url.pathname.endsWith("/stats");
      const isExpired = expiredCalls < 2;
      expiredCalls += 1;
      if (isExpired) {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Token inválido o expirado" }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          isStats ? { total: 1500, count: 1, avg: 1500, last_used: null } : [ROW],
        ),
      });
    });

    await page.goto("/expenses");

    await expect(page.getByText("Farmacia Central").first()).toBeVisible({ timeout: 20_000 });
    expect(refreshCalls).toBe(1);
    expect(authHeaders).toContain("Bearer fresh-token");
    expect(await page.evaluate(() => localStorage.getItem("auth_token"))).toBe("fresh-token");
    await expect(page).toHaveURL(/\/expenses/);
  });

  test("a failed refresh clears the token and sends the user to login", async ({ page }) => {
    // seedAuth re-runs its init script on the redirect and would put the token
    // back; set it once so the assertion sees the interceptor's clear.
    await page.goto("/login");
    await page.evaluate(() => localStorage.setItem("auth_token", "expired-token"));
    await mockBackend(page, OVERRIDES);

    await page.route("**/api/auth/refresh", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Sesión expirada" }),
      }),
    );
    await page.route(/\/api\/expenses(\/stats)?(\?.*)?$/, (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Token inválido o expirado" }),
      }),
    );

    await page.goto("/expenses");

    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    expect(await page.evaluate(() => localStorage.getItem("auth_token"))).toBeNull();
  });
});
