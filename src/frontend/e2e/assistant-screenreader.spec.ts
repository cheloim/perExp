import { test, expect, type Page } from "@playwright/test";
import { openApp, openAssistant, mockBackend, seedAuth } from "./helpers";

const STREAM_PATH = "/api/analysis/stream";

/**
 * Accessibility-tree verification (issue #415, criterion 5).
 *
 * This reads the browser's COMPUTED accessibility tree via CDP — the exact
 * roles, names and properties a screen reader consumes after ARIA resolution,
 * not the attributes we wrote in JSX. It catches things axe cannot: a wrong
 * accessible name, a live region that is present but not exposed as one, an
 * element whose computed role is "generic" instead of "button".
 *
 * WHAT THIS IS NOT: it is still not NVDA or VoiceOver. It cannot tell you the
 * announcement cadence, whether the streaming text is too chatty to be usable,
 * or how the dialog behaves under a virtual cursor. Those remain a manual pass.
 */
type AXNode = {
  nodeId: string;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string };
  properties?: Array<{ name: string; value?: { value?: string | number | boolean } }>;
  childIds?: string[];
};

type AXTree = {
  nodes: AXNode[];
};

const roleOf = (n: AXNode) => n.role?.value ?? "";
const nameOf = (n: AXNode) => n.name?.value ?? "";
const valueOf = (n: AXNode) => n.value?.value ?? "";

function prop(n: AXNode, key: string): string | number | boolean | undefined {
  return n.properties?.find((p) => p.name === key)?.value?.value;
}

/** Fetch the full computed accessibility tree. */
async function axTree(page: Page): Promise<AXNode[]> {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Accessibility.enable");
    const { nodes } = (await client.send("Accessibility.getFullAXTree")) as AXTree;
    return nodes;
  } finally {
    await client.detach();
  }
}

function find(nodes: AXNode[], role: string, name?: string) {
  return nodes.find((n) => roleOf(n) === role && (name === undefined || nameOf(n) === name));
}

test.describe("assistant accessibility tree (screen-reader proxy)", () => {
  test("exposes the dialog with the right role, name and modality", async ({ page }) => {
    await openApp(page);
    await openAssistant(page);
    await expect(page.getByRole("dialog", { name: "Asistente de Gastos" })).toBeVisible();

    const nodes = await axTree(page);
    const dialog = find(nodes, "dialog", "Asistente de Gastos");

    expect(dialog, "no computed role=dialog with that name in the AX tree").toBeTruthy();
    expect(
      dialog && String(prop(dialog, "modal")),
      "the dialog must be exposed as modal, or a screen reader lets the virtual cursor wander into the page behind it",
    ).toBe("true");
  });

  test("names the controls in each state's accessibility tree", async ({ page }) => {
    await seedAuth(page);
    await mockBackend(page);
    await page.goto("/guide");

    // A short, completed stream so the suggestions state can be reached.
    const sse = (chunks: string[]) =>
      chunks.map((c) => `data: ${JSON.stringify({ text: c })}\n\n`).join("") + "data: [DONE]\n\n";
    await page.route(
      (u) => u.pathname === STREAM_PATH,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: sse(["gastaste $12.340 este mes"]),
        }),
    );

    await openAssistant(page);
    await expect(page.getByRole("dialog", { name: "Asistente de Gastos" })).toBeVisible();

    // ── State 1: idle ──────────────────────────────────────────────────────
    const idle = await axTree(page);

    expect(
      find(idle, "textbox", "Preguntá sobre tus gastos"),
      "composer has no accessible name",
    ).toBeTruthy();

    for (const label of ["Enviar mensaje", "Cerrar asistente"]) {
      expect(
        find(idle, "button", label),
        `button "${label}" is not exposed by that name`,
      ).toBeTruthy();
    }

    // The starter chips must read as buttons, not generic containers.
    expect(
      find(idle, "button", "¿Cuánto llevo gastado este mes?"),
      "starter chip is not a named button",
    ).toBeTruthy();

    // The follow-up group must NOT be here yet — it only exists after a
    // response. Asserting it in idle was how this test first failed.
    expect(
      find(idle, "group", "Sugerencias de seguimiento"),
      "follow-up group leaked into idle state",
    ).toBeFalsy();

    // ── State 3: suggestions (after a completed response) ─────────────────
    await page.getByRole("textbox", { name: "Preguntá sobre tus gastos" }).fill("resumen");
    await page.getByRole("textbox", { name: "Preguntá sobre tus gastos" }).press("Enter");
    await expect(page.getByText("gastaste $12.340 este mes")).toBeVisible();
    await expect(page.getByRole("group", { name: "Sugerencias de seguimiento" })).toBeVisible();

    const answered = await axTree(page);
    expect(
      find(answered, "group", "Sugerencias de seguimiento"),
      "follow-up suggestions are not exposed as a labelled group",
    ).toBeTruthy();
    expect(
      find(answered, "button", "Compará con el mes pasado"),
      "a follow-up chip is not exposed as a named button",
    ).toBeTruthy();
  });

  test("the streaming status is a real live region with the expected text", async ({ page }) => {
    await seedAuth(page);
    await mockBackend(page);
    await page.goto("/guide");
    // Hold the stream open so the in-flight state stays observable.
    await page.route(
      (u) => u.pathname === STREAM_PATH,
      () =>
        new Promise<void>(() => {
          /* never settles — the test navigates away and Playwright tears it down */
        }),
    );
    await openAssistant(page);

    // Idle first: the live region must exist BEFORE it announces anything, or
    // screen readers that only register live regions at insertion will never
    // announce the later change.
    const idle = await axTree(page);
    const idleStatus = idle.find(
      (n) =>
        ["status", "LiveRegion"].includes(roleOf(n)) ||
        prop(n, "live") !== undefined ||
        prop(n, "atomic") !== undefined,
    );
    expect(idleStatus, "no live region is exposed while idle").toBeTruthy();

    const box = page.getByRole("textbox", { name: "Preguntá sobre tus gastos" });
    await box.fill("hola");
    await box.press("Enter");
    await expect(page.getByRole("button", { name: "Cancelar respuesta" })).toBeVisible();

    const nodes = await axTree(page);

    // The announcement text must be present in the tree, not just in the DOM.
    const announcing = nodes.filter(
      (n) => nameOf(n).includes("Analizando") || valueOf(n).includes("Analizando"),
    );
    expect(
      announcing.length,
      '"Analizando tus gastos…" is in the DOM but not exposed in the accessibility tree',
    ).toBeGreaterThan(0);

    // Streaming swaps the send button for a cancel button; both names must be
    // resolvable so the button is not announced as an unnamed control.
    expect(
      find(nodes, "button", "Cancelar respuesta"),
      "cancel affordance has no accessible name",
    ).toBeTruthy();
  });

  test("error and retry are exposed as named buttons", async ({ page }) => {
    await seedAuth(page);
    await mockBackend(page);
    await page.goto("/guide");
    await page.route(
      (u) => u.pathname === STREAM_PATH,
      (route) => route.abort("connectionfailed"),
    );

    await openAssistant(page);
    const box = page.getByRole("textbox", { name: "Preguntá sobre tus gastos" });
    await box.fill("pregunta");
    await box.press("Enter");

    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();

    const nodes = await axTree(page);
    for (const label of ["Reintentar", "Nueva consulta"]) {
      expect(
        find(nodes, "button", label),
        `error action "${label}" has no accessible name`,
      ).toBeTruthy();
    }

    // The error bubble must be reachable as text, not just visually styled.
    expect(
      nodes.some((n) => nameOf(n).includes("No pude procesar la consulta")),
      "the error message is not exposed as text in the accessibility tree",
    ).toBe(true);
  });

  test("the history toggle reports its pressed state", async ({ page }) => {
    await openApp(page);
    await openAssistant(page);
    await expect(page.getByRole("dialog", { name: "Asistente de Gastos" })).toBeVisible();

    const nodes = await axTree(page);
    const chat = find(nodes, "button", "Chat");
    expect(chat, "the Chat tab is not exposed by name").toBeTruthy();
    // The AX tree reports `pressed` as the STRING "true"/"false", not a
    // boolean, so compare on the string form.
    expect(
      chat && String(prop(chat, "pressed")),
      "aria-pressed must resolve into the tree as `true` for the active tab, or the state is silent",
    ).toBe("true");

    const history = nodes.find(
      (n) => roleOf(n) === "button" && nameOf(n).trim().startsWith("Historial"),
    );
    expect(history, "the Historial tab is not exposed by name").toBeTruthy();
    expect(
      history && String(prop(history, "pressed")),
      "aria-pressed must resolve into the tree as `false` for the inactive tab",
    ).toBe("false");
  });
});
