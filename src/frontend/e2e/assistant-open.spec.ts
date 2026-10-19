import { test, expect } from "@playwright/test";
import { openApp, openAssistant, reopenTrigger, isMobileViewport } from "./helpers";

/**
 * Issue #416 / #415 — the assistant must open in ONE click from the FAB,
 * rendering the centered card, not an intermediate collapsed bubble.
 *
 * On mobile the "one click" is the speed-dial tap sequence, since the AI FAB
 * is intentionally hidden below md.
 */
test.describe("AI assistant modal", () => {
  test("opens in one interaction from the FAB", async ({ page }) => {
    await openApp(page);

    await expect(reopenTrigger(page)).toBeVisible();
    await openAssistant(page);

    const dialog = page.getByRole("dialog", { name: "Asistente de Gastos" });
    await expect(dialog).toBeVisible();

    // The collapsed bubble must not appear alongside the open card.
    await expect(page.getByTitle("Abrir Asistente de Gastos")).toHaveCount(0);
  });

  test("closes on Escape and restores the trigger", async ({ page }) => {
    await openApp(page);
    await openAssistant(page);
    await expect(page.getByRole("dialog", { name: "Asistente de Gastos" })).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog", { name: "Asistente de Gastos" })).toHaveCount(0);
    await expect(reopenTrigger(page)).toBeVisible();
  });

  test("closes on backdrop click", async ({ page }) => {
    test.skip(isMobileViewport(page), "mobile renders a full-bleed sheet with no backdrop to hit");

    await openApp(page);
    await openAssistant(page);

    const dialog = page.getByRole("dialog", { name: "Asistente de Gastos" });
    await expect(dialog).toBeVisible();

    // The backdrop wrapper is the dialog's parent; click it outside the card.
    await page.mouse.click(20, 20);

    await expect(dialog).toHaveCount(0);
  });

  test("the dialog is exposed as a modal to assistive tech", async ({ page }) => {
    await openApp(page);
    await openAssistant(page);

    const dialog = page.getByRole("dialog", { name: "Asistente de Gastos" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});
