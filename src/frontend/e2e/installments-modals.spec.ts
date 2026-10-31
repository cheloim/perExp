import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { mockBackend, seedAuth } from "./helpers";

/**
 * Both recurring modals share one shell. The auto-detected review used to paint
 * a purple gradient header while "Gestionar" used the Adwaita surface, so the
 * same subscription looked like two different products.
 */

const DETECTED = [
  {
    id: 11,
    merchant_key: "Netflix",
    description: "Netflix",
    amount: 8000,
    frequency: "monthly",
    next_charge_date: "2026-11-05",
    is_active: false,
    source: "auto",
    created_at: "2026-10-01T00:00:00Z",
  },
];

const RECURRING = [
  {
    id: 21,
    merchant_key: "Spotify",
    description: "Spotify",
    amount: 4500,
    frequency: "monthly",
    next_charge_date: "2026-11-10",
    is_active: true,
    source: "auto",
    created_at: "2026-10-01T00:00:00Z",
  },
];

test.beforeEach(async ({ page }) => {
  await seedAuth(page);
  await mockBackend(page, {
    "/recurring/auto-detected": DETECTED,
    "/recurring": RECURRING,
    "/dashboard/installments": [],
    "/dashboard/installments/monthly-load": [],
  });
  await page.goto("/installments");
});

test("the detected review is an accessible Adwaita dialog", async ({ page }) => {
  await page.getByRole("button", { name: "Revisar" }).click();

  const dialog = page.getByRole("dialog", { name: "Gastos auto-detectados" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  const className = (await dialog.getAttribute("class")) ?? "";
  expect(className).toContain("bg-[var(--color-surface)]");
  expect(className).not.toContain("bg-gradient");

  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(results.violations).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("the manage dialog uses the same shell", async ({ page }) => {
  await page.locator("button", { hasText: "Spotify" }).first().click();

  const dialog = page.getByRole("dialog", { name: "Spotify" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  const className = (await dialog.getAttribute("class")) ?? "";
  expect(className).toContain("bg-[var(--color-surface)]");
  expect(className).not.toContain("bg-gradient");
});
