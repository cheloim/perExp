import { test, expect } from "@playwright/test";
import { openApp, openAssistant, seedAuth, mockBackend } from "./helpers";

/**
 * Open-time budget for the assistant modal (issue #415 asks for a measurable
 * improvement, not just a claim).
 *
 * The component marks "ai-assistant:open-start" in toggleDrawer and
 * "ai-assistant:open-end" on the first painted frame; the resulting duration is
 * exposed on window.__AI_ASSISTANT_OPEN_MS__.
 *
 * The budget is deliberately generous. This asserts "opening the card is not
 * accidentally quadratic / not blocking on a lazy chunk", not a hard SLA — CI
 * runners are noisy and a tight number here would just flake.
 */
const OPEN_BUDGET_MS = 300;

test.describe("assistant performance", () => {
  test("opens within the budget", async ({ page }) => {
    await openApp(page);

    await openAssistant(page);
    await expect(page.getByRole("dialog", { name: "Asistente de Gastos" })).toBeVisible();

    const ms = await page.evaluate(
      () => (window as unknown as Record<string, number>).__AI_ASSISTANT_OPEN_MS__ ?? -1,
    );

    expect(ms, "open-start mark never fired").toBeGreaterThan(0);
    expect(
      ms,
      `assistant took ${ms.toFixed(1)}ms to open (budget ${OPEN_BUDGET_MS}ms)`,
    ).toBeLessThan(OPEN_BUDGET_MS);
  });

  test("reopening stays within budget — no per-open leak", async ({ page }) => {
    await openApp(page);

    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      await openAssistant(page);
      await expect(page.getByRole("dialog", { name: "Asistente de Gastos" })).toBeVisible();
      samples.push(
        await page.evaluate(
          () => (window as unknown as Record<string, number>).__AI_ASSISTANT_OPEN_MS__ ?? -1,
        ),
      );
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Asistente de Gastos" })).toHaveCount(0);
    }

    // Every reopen must stay inside the budget, and the last one must not have
    // drifted far past the first — that is the leak signature we care about.
    for (const [i, ms] of samples.entries()) {
      expect(ms, `reopen #${i + 1} took ${ms.toFixed(1)}ms`).toBeLessThan(OPEN_BUDGET_MS);
    }
    expect(
      samples[4],
      `open drifted from ${samples[0].toFixed(1)}ms to ${samples[4].toFixed(1)}ms`,
    ).toBeLessThan(samples[0] * 3 + 50);
  });

  test("a long thread does not block interaction", async ({ page }) => {
    // Seed via init script so the fixture survives navigation, and start with
    // the drawer closed so the FAB is present to click.
    const now = Date.now();
    const longThread = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0
        ? { role: "user", text: `pregunta ${i}` }
        : { role: "assistant", text: `respuesta ${i} con **negritas** y texto normal` },
    );
    await openApp(page, "/guide", {
      sessions: [{ id: `${now}-seed`, ts: now, messages: longThread }],
      activeId: `${now}-seed`,
    });

    await openAssistant(page);
    const box = page.getByRole("textbox", { name: "Preguntá sobre tus gastos" });
    await expect(box).toBeVisible();

    // 40 messages must actually be rendered, or this proves nothing.
    await expect(page.getByText("pregunta 0")).toBeVisible();
    await expect(page.getByText("pregunta 38")).toBeVisible();

    // The composer must stay responsive with that history on screen.
    const start = Date.now();
    await box.fill("typing con historial largo");
    await expect(box).toHaveValue("typing con historial largo");
    const elapsed = Date.now() - start;
    expect(elapsed, `typing blocked for ${elapsed}ms with a long history`).toBeLessThan(1500);
  });

  test("a streaming chunk renders one bubble, not the whole history", async ({ page }) => {
    const STREAM_PATH = "/api/analysis/stream";
    const sse = (chunks: string[]) =>
      chunks.map((c) => `data: ${JSON.stringify({ text: c })}\n\n`).join("") + "data: [DONE]\n\n";

    /**
     * Send the same prompt against a history of `historyLen` messages and
     * return how many Bubble function bodies ran.
     *
     * Two runs with identical input, differing only in history size: if memo
     * works the counts are equal, because only the tail bubble receives a new
     * `msg` reference. Without memo the 40-message run would render 10x more.
     *
     * Runs get their own page so route registrations and init scripts never
     * stack on top of each other.
     */
    const measure = async (historyLen: number) => {
      const p = await page.context().newPage();
      try {
        const ts = Date.now();
        const id = `hist-${historyLen}-${ts}`;
        const history = Array.from({ length: historyLen }, (_, i) =>
          i % 2 === 0
            ? { role: "user", text: `pregunta ${i}` }
            : { role: "assistant", text: `respuesta ${i}` },
        );

        await seedAuth(p, { sessions: [{ id, ts, messages: history }], activeId: id });
        await mockBackend(p);
        // Registered after mockBackend so it wins (Playwright matches the most
        // recently registered route first).
        await p.route(
          (u) => u.pathname === STREAM_PATH,
          (route) =>
            route.fulfill({
              status: 200,
              contentType: "text/event-stream",
              body: sse(["chunk A", "chunk B", "chunk C"]),
            }),
        );
        await p.goto("/guide");
        await openAssistant(p);

        // Mounting the seeded history already rendered every bubble; zero the
        // counter so only the send below is counted.
        await p.evaluate(() => {
          (window as unknown as { __BUBBLE_RENDERS__?: number }).__BUBBLE_RENDERS__ = 0;
        });

        const box = p.getByRole("textbox", { name: "Preguntá sobre tus gastos" });
        await box.fill("pregunta nueva");
        await box.press("Enter");
        await expect(p.getByText("chunk C")).toBeVisible();
        // The send button is DISABLED when idle (empty input), so it is not a
        // settled-signal. The aria-live region is: it holds "Analizando…"
        // while streaming and empties when the stream ends.
        await expect(p.locator('[role="status"][aria-live="polite"]')).toHaveText("");

        return await p.evaluate(
          () => (window as unknown as { __BUBBLE_RENDERS__?: number }).__BUBBLE_RENDERS__ ?? -1,
        );
      } finally {
        await p.close();
      }
    };

    const short = await measure(4);
    const long = await measure(40);
    console.log(`BUBBLE RENDERS — history 4: ${short}, history 40: ${long}`);

    expect(short, "counter never ran — dev build?").toBeGreaterThan(0);
    expect(long, "counter never ran — dev build?").toBeGreaterThan(0);

    // The actual claim: render cost per chunk does not scale with history.
    expect(
      Math.abs(long - short),
      `bubble renders scaled with history: ${short} renders at 4 messages vs ${long} at 40`,
    ).toBeLessThanOrEqual(2);

    // And the absolute number must stay far below the message count — the
    // signature of O(1) per chunk instead of O(n).
    expect(long, `${long} bubble renders for a 40-message history`).toBeLessThan(20);
  });
});
