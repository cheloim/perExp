import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  openApp,
  mockBackend,
  seedAuth,
  openAssistant,
  focusOutsideDialog,
  settleOpenAnimations,
} from "./helpers";

const STREAM_PATH = "/api/analysis/stream";

test.describe("assistant accessibility", () => {
  test("the open dialog has no detectable WCAG A/AA violations", async ({ page }) => {
    await openApp(page);
    await openAssistant(page);
    const dialog = page.getByRole("dialog", { name: "Asistente de Gastos" });
    await expect(dialog).toBeVisible();
    // axe flattens colors through ancestor opacity: run only once the 0.2s
    // open fade has settled, or a mid-fade scan invents contrast violations.
    await settleOpenAnimations(dialog);

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

    // Same fade race as above; the streaming dot's infinite `animate-pulse` in
    // this subtree is skipped by the helper (it has no end state to await).
    await settleOpenAnimations(page.getByRole("dialog", { name: "Asistente de Gastos" }));

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

    // Wait for the component's own autofocus to have FIRED before seeding
    // outside focus. It runs once per open, ~100ms after mount; if we seed
    // before it fires it steals focus back into the composer and the trap is
    // never actually exercised (the test then passes for the wrong reason).
    await expect(page.getByRole("textbox", { name: "Preguntá sobre tus gastos" })).toBeFocused();

    // Same precondition as the Shift+Tab case: focus outside the dialog must
    // be pulled in, not followed out of the modal. `firstOutside` sits at the
    // head of the document, so its NEXT tabbable is outside the dialog.
    await focusOutsideDialog(page, "firstOutside");

    // First Tab is the escape case: without handling focus-outside, this
    // walks to whatever precedes the trigger and focus never enters at all.
    await page.keyboard.press("Tab");
    const pulledIn = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return !!dlg && !!document.activeElement && dlg.contains(document.activeElement);
    });
    expect(pulledIn, "Tab from outside the dialog left focus outside").toBe(true);

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

    // Same as the Tab case: let the 100ms autofocus fire first, or it undoes
    // the seeding below and the trap is never tested.
    await expect(page.getByRole("textbox", { name: "Preguntá sobre tus gastos" })).toBeFocused();

    // Exactly the CI failure: focus still sits on an element OUTSIDE the
    // dialog (the trigger that opened it), before the 100ms autofocus runs.
    // The trap must pull focus back in instead of letting Shift+Tab walk out.
    // `beforeDialog` sits right in front of the dialog, so its PREVIOUS
    // tabbable is outside — that is what makes Shift+Tab escape.
    await focusOutsideDialog(page, "beforeDialog");

    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]');
          return !!dlg && !!document.activeElement && dlg.contains(document.activeElement);
        }),
      )
      .toBe(true);

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

    // Keyboard activation sends the question straight away: a chip is a
    // shortcut into the conversation, not a composer filler.
    await chip.focus();
    await expect(chip).toBeFocused();
    await page.keyboard.press("Enter");

    // The focus goes back to the composer so the keyboard user can keep typing,
    // and the composer is left empty rather than pre-filled.
    await expect(box).toBeFocused();
    await expect(box).toHaveValue("");
    // The user's bubble carries the same text as the chip, and the chip itself
    // is unmounted as soon as the thread stops being empty — take the last
    // match so the assertion holds either way.
    await expect(
      dialog.getByText("¿Cuánto llevo gastado este mes?").last(),
    ).toBeVisible();
  });
});
