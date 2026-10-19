import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seedAuth, mockBackend } from "./helpers";

/**
 * e2e coverage for the investments surface of the unified assistant.
 *
 * Before the unification `InvestmentsAssistant` had no tests at all. These
 * mirror the spending suite so both surfaces are held to the same bar.
 */

const STREAM_PATH = "/api/investments/chat/stream";
const OPEN_BUDGET_MS = 300;

const sseBody = (chunks: string[]) =>
  chunks.map((c) => `data: ${JSON.stringify({ text: c })}\n\n`).join("") + "data: [DONE]\n\n";

async function openInvestmentsApp(page: import("@playwright/test").Page) {
  await seedAuth(page);
  await mockBackend(page);
  await page.goto("/investments");
}

/** The investments surface owns its own floating trigger. */
async function openAssistant(page: import("@playwright/test").Page) {
  const trigger = page.getByRole("button", {
    name: "Abrir Asistente de Inversiones",
  });
  await trigger.waitFor({ state: "visible", timeout: 15_000 });
  await trigger.click();
}

test.describe("investments assistant", () => {
  test("opens in one interaction and is exposed as a modal", async ({ page }) => {
    await openInvestmentsApp(page);
    await openAssistant(page);

    const dialog = page.getByRole("dialog", { name: "Asistente de Inversiones" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  test("does not offer the spending-only monthly analysis", async ({ page }) => {
    await openInvestmentsApp(page);
    await openAssistant(page);

    await expect(page.getByRole("button", { name: "✨ Analizar gastos del mes" })).toHaveCount(0);
  });

  test("closes on Escape and the trigger comes back", async ({ page }) => {
    await openInvestmentsApp(page);
    await openAssistant(page);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Abrir Asistente de Inversiones" }),
    ).toBeVisible();
  });

  test("Enter sends and Shift+Enter inserts a newline", async ({ page }) => {
    await openInvestmentsApp(page);
    await page.route(
      (u) => u.pathname === STREAM_PATH,
      (route) =>
        route.fulfill({ status: 200, contentType: "text/event-stream", body: sseBody(["hola"]) }),
    );
    await openAssistant(page);

    const box = page.getByRole("textbox", { name: "Preguntá sobre tus inversiones" });

    await box.fill("hola");
    await box.press("Enter");
    await expect(page.getByText("hola").first()).toBeVisible();

    await box.fill("linea1");
    await box.press("Shift+Enter");
    await box.type("linea2");
    await expect(box).toHaveValue("linea1\nlinea2");
  });

  test("caps input at the character limit and shows the counter", async ({ page }) => {
    await openInvestmentsApp(page);
    await openAssistant(page);

    const box = page.getByRole("textbox", { name: "Preguntá sobre tus inversiones" });
    await box.fill("x".repeat(2100));
    await expect(box).toHaveValue("x".repeat(2000));
    await expect(page.getByText(/2000 \/ 2000/)).toBeVisible();
  });

  test("send becomes Cancel during streaming and aborts the response", async ({ page }) => {
    await openInvestmentsApp(page);
    // Never settles so the in-flight state is observable.
    await page.route(
      (u) => u.pathname === STREAM_PATH,
      () => new Promise<void>(() => {}),
    );
    await openAssistant(page);

    const box = page.getByRole("textbox", { name: "Preguntá sobre tus inversiones" });
    await box.fill("pregunta larga");
    await box.press("Enter");

    const cancel = page.getByRole("button", { name: "Cancelar respuesta" });
    await expect(cancel).toBeVisible();
    // The status names the domain being analysed — "gastos" would be the bug.
    await expect(page.getByText("Analizando tus inversiones…")).toBeVisible();

    await cancel.click();
    await expect(page.getByText("Respuesta cancelada.")).toBeVisible();
  });

  test("shows the error state with a retry that re-sends the prompt", async ({ page }) => {
    await openInvestmentsApp(page);
    let calls = 0;
    await page.route(
      (u) => u.pathname === STREAM_PATH,
      (route) => {
        calls += 1;
        return calls === 1
          ? route.abort("connectionfailed")
          : route.fulfill({
              status: 200,
              contentType: "text/event-stream",
              body: sseBody(["ok-retry"]),
            });
      },
    );
    await openAssistant(page);

    const box = page.getByRole("textbox", { name: "Preguntá sobre tus inversiones" });
    await box.fill("mi pregunta");
    await box.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Asistente de Inversiones" });
    await expect(dialog.getByText("No pude procesar la consulta", { exact: false })).toBeVisible();

    await dialog.getByRole("button", { name: "Reintentar" }).click();
    await expect(dialog.getByText("ok-retry")).toBeVisible();
    expect(calls).toBe(2);
    await expect(dialog.getByText("mi pregunta")).toHaveCount(1);
  });

  test("opens within the performance budget", async ({ page }) => {
    await openInvestmentsApp(page);
    await openAssistant(page);
    await expect(page.getByRole("dialog", { name: "Asistente de Inversiones" })).toBeVisible();

    const ms = await page.evaluate(
      () => (window as unknown as Record<string, number>).__AI_ASSISTANT_OPEN_MS__ ?? -1,
    );
    expect(ms, "open-start mark never fired").toBeGreaterThan(0);
    expect(ms, `took ${ms.toFixed(1)}ms (budget ${OPEN_BUDGET_MS}ms)`).toBeLessThan(OPEN_BUDGET_MS);
  });

  test("has no axe violations", async ({ page }) => {
    await openInvestmentsApp(page);
    await openAssistant(page);
    await expect(page.getByRole("dialog", { name: "Asistente de Inversiones" })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
