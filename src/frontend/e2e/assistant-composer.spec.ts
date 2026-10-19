import { test, expect } from "@playwright/test";
import { mockBackend, seedAuth, openAssistant } from "./helpers";

const STREAM_PATH = "/api/analysis/stream";

/** Minimal SSE body matching what AIAssistant's streamTo parser expects. */
function sseBody(chunks: string[]) {
  return (
    chunks.map((c) => `data: ${JSON.stringify({ text: c })}\n\n`).join("") + "data: [DONE]\n\n"
  );
}

test.describe("assistant composer", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await mockBackend(page);
    await page.goto("/guide");
    await openAssistant(page);
  });

  test("textarea has an accessible name and grows to multiline", async ({ page }) => {
    const box = page.getByRole("textbox", { name: "Preguntá sobre tus gastos" });
    await expect(box).toBeVisible();

    await box.fill("Compara el gasto en supermercado\nde los últimos 3 meses");
    await expect(box).toHaveValue(/supermercado/);

    // Two lines must render as two rows, not one clipped line.
    const height = await box.evaluate((el) => (el as HTMLTextAreaElement).clientHeight);
    expect(height).toBeGreaterThan(30);
  });

  test("Enter sends, Shift+Enter inserts a newline", async ({ page }) => {
    await page.route(
      (u) => u.pathname === STREAM_PATH,
      (route) =>
        route.fulfill({ status: 200, contentType: "text/event-stream", body: sseBody(["hola"]) }),
    );

    const box = page.getByRole("textbox", { name: "Preguntá sobre tus gastos" });

    // Shift+Enter must NOT send — it must leave a newline behind.
    await box.click();
    await box.pressSequentially("primera linea");
    await box.press("Shift+Enter");
    await box.pressSequentially("segunda linea");
    await expect(box).toHaveValue("primera linea\nsegunda linea");
    await expect(page.getByText("hola")).toHaveCount(0);

    // Enter must send.
    await box.press("Enter");
    await expect(page.getByText("primera linea")).toBeVisible();
    await expect(page.getByText("hola")).toBeVisible();
  });

  test("send button is disabled while the input is empty", async ({ page }) => {
    const send = page.getByRole("button", { name: "Enviar mensaje" });
    await expect(send).toBeDisabled();

    await page.getByRole("textbox", { name: "Preguntá sobre tus gastos" }).fill("algo");
    await expect(send).toBeEnabled();
  });

  test("caps input at the character limit and shows the counter", async ({ page }) => {
    const box = page.getByRole("textbox", { name: "Preguntá sobre tus gastos" });
    await box.fill("x".repeat(2500));

    const value = await box.inputValue();
    expect(value.length).toBeLessThanOrEqual(2000);
    await expect(page.getByText(/2000 \/ 2000/)).toBeVisible();
  });

  test("send becomes Cancel during streaming and aborts the response", async ({ page }) => {
    // `route.fulfill` closes the body immediately, which ends the reader loop and
    // flips `streaming` back to false. Holding the route open is the only way to
    // observe the in-flight state deterministically.
    await page.route(
      (u) => u.pathname === STREAM_PATH,
      (_route) =>
        new Promise<void>(() => {
          /* never settles — the test navigates away and Playwright tears it down */
        }),
    );

    const box = page.getByRole("textbox", { name: "Preguntá sobre tus gastos" });
    await box.fill("pregunta larga");
    await box.press("Enter");

    const cancel = page.getByRole("button", { name: "Cancelar respuesta" });
    await expect(cancel).toBeVisible();
    await expect(page.getByText("Analizando tus gastos…")).toBeVisible();

    await cancel.click();
    await expect(page.getByText("Respuesta cancelada.")).toBeVisible();
    // The FAB-side flow must be usable again once cancelled.
    await expect(page.getByRole("textbox", { name: "Preguntá sobre tus gastos" })).toBeEnabled();
  });

  test("shows the error state with a retry that re-sends the prompt", async ({ page }) => {
    let calls = 0;
    await page.route(
      (u) => u.pathname === STREAM_PATH,
      (route) => {
        calls += 1;
        // Fail the first attempt, succeed the second.
        return calls === 1
          ? route.abort("connectionfailed")
          : route.fulfill({
              status: 200,
              contentType: "text/event-stream",
              body: sseBody(["ok-retry"]),
            });
      },
    );

    const box = page.getByRole("textbox", { name: "Preguntá sobre tus gastos" });
    await box.fill("mi pregunta");
    await box.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Asistente de Gastos" });
    await expect(dialog.getByText("No pude procesar la consulta", { exact: false })).toBeVisible();

    await dialog.getByRole("button", { name: "Reintentar" }).click();
    await expect(dialog.getByText("ok-retry")).toBeVisible();
    expect(calls).toBe(2);

    // The retry must not duplicate the user bubble.
    await expect(dialog.getByText("mi pregunta")).toHaveCount(1);
  });
});
