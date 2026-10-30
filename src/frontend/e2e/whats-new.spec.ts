import { test, expect } from "@playwright/test";
import { DEFAULT_MOCKS, mockBackend, seedAuth } from "./helpers";

test.describe("What's New dismissal", () => {
  test("a device with no local dismissal honours the one saved on the server", async ({ page }) => {
    // The device remembers having dismissed an older release; the server has
    // the current one. The modal must not appear just because /auth/me took a
    // moment to answer.
    await seedAuth(page, { whatsNewDismissedVersion: "v1.5" });
    const me = {
      ...(DEFAULT_MOCKS["/auth/me"] as Record<string, unknown>),
      whats_new_dismissed_version: "v1.6",
    };
    // Holding /auth/me forces the decision to land after the first render,
    // which is exactly the window where the stale timer used to be scheduled.
    await mockBackend(page, { "/auth/me": me }, { "/auth/me": 700 });

    await page.goto("/");

    // The modal is scheduled for 1.5s after the first render. Wait past it: a
    // stale timer left over from before the user loaded would fire here.
    await page.waitForTimeout(5000);
    await expect(page.getByText("¡Novedades!")).toHaveCount(0);
  });
});
