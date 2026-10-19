import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openApp, mockBackend, seedAuth, openAssistant } from "./helpers";

const STREAM_PATH = "/api/analysis/stream";

test.describe("assistant accessibility", () => {
  test("the open dialog has no detectable WCAG A/AA violations", async ({ page }) => {
    await openApp(page);
    await openAssistant(page);
    await expect(page.getByRole("dialog", { name: "Asistente de Gastos" })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .include('[role="dialog"]')
      .analyze();

    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      help: v.help,
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });

  test("the composer is also clean while a response is streaming", async ({ page }) => {
    await seedAuth(page);
    await mockBackend(page);
    await page.goto("/guide");
    await page.route(
      (u) => u.pathname === STREAM_PATH,
      () =>
        new Promise<void>(() => {
          /* held open so the streaming state stays observable */
        }),
    );

    await openAssistant(page);
    await page.getByRole("textbox", { name: "Preguntá sobre tus gastos" }).fill("hola");
    await page.getByRole("textbox", { name: "Preguntá sobre tus gastos" }).press("Enter");
    await expect(page.getByRole("button", { name: "Cancelar respuesta" })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .include('[role="dialog"]')
      .analyze();

    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test("focus is trapped inside the dialog and cycles on Tab", async ({ page }) => {
    await openApp(page);
    await openAssistant(page);

    const dialog = page.getByRole("dialog", { name: "Asistente de Gastos" });
    await expect(dialog).toBeVisible();

    // Tab many times; focus must never leave the dialog subtree.
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        return !!dlg && !!document.activeElement && dlg.contains(document.activeElement);
      });
      expect(inside, `focus escaped the dialog on Tab #${i + 1}`).toBe(true);
    }
  });

  test("Shift+Tab cycles backwards without escaping", async ({ page }) => {
    await openApp(page);
    await openAssistant(page);
    await expect(page.getByRole("dialog", { name: "Asistente de Gastos" })).toBeVisible();

    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Shift+Tab");
      const inside = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        return !!dlg && !!document.activeElement && dlg.contains(document.activeElement);
      });
      expect(inside, `focus escaped the dialog on Shift+Tab #${i + 1}`).toBe(true);
    }
  });

  test("streaming status is announced via a live region", async ({ page }) => {
    await seedAuth(page);
    await mockBackend(page);
    await page.goto("/guide");
    await page.route(
      (u) => u.pathname === STREAM_PATH,
      () => new Promise<void>(() => {}),
    );

    await openAssistant(page);
    await page.getByRole("textbox", { name: "Preguntá sobre tus gastos" }).fill("hola");
    await page.getByRole("textbox", { name: "Preguntá sobre tus gastos" }).press("Enter");

    const live = page.locator('[role="status"][aria-live="polite"]');
    await expect(live).toHaveText(/Analizando/);
  });

  test("suggestion chips are reachable and operable by keyboard", async ({ page }) => {
    await openApp(page);
    await openAssistant(page);

    const dialog = page.getByRole("dialog", { name: "Asistente de Gastos" });
    const chip = dialog.getByRole("button", { name: "¿Cuánto llevo gastado este mes?" });
    await expect(chip).toBeVisible();

    const box = page.getByRole("textbox", { name: "Preguntá sobre tus gastos" });

    // The component auto-focuses the composer 100ms after opening. Focusing the
    // chip BEFORE that timer fires loses the race: the timer steals focus back
    // to the textarea, Enter lands in an empty composer, and the chip never
    // activates. Waiting on the app's own autofocus (rather than an arbitrary
    // sleep) proves the timer has already fired — it runs once per open.
    await expect(box).toBeFocused();

    // Keyboard activation must populate the composer (not send).
    await chip.focus();
    await expect(chip).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(box).toBeFocused();
    await expect(box).toHaveValue("¿Cuánto llevo gastado este mes?");
  });
});
