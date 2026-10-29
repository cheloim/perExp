import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockBackend, seedAuth } from "./helpers";

/**
 * E2E for the always-on bulk selection on /expenses.
 *
 * The list is stubbed at the network layer, like the search specs: the test
 * exercises the real UI → bar → request → render loop without a seeded
 * backend. The bulk endpoints are captured so each assertion checks the
 * contract the UI actually sends.
 */

type Row = {
  id: number;
  date: string;
  description: string;
  amount: number;
  currency: string;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  card: string;
  bank: string;
  person: string;
  notes: string;
  tags: { id: number; name: string; color: string; group_name: string }[];
  is_income: boolean;
};

const CUENTA = { id: 10, name: "Visa", color: "#3584e4", group_name: "cuenta" };
const VIAJE = { id: 20, name: "Viaje", color: "#f5c211", group_name: "otros" };
const OCIO = { id: 21, name: "Ocio", color: "#9141ac", group_name: "otros" };

const ROWS: Row[] = [
  {
    id: 1,
    date: "2026-10-01",
    description: "Farmacia Central",
    amount: 1500,
    currency: "ARS",
    category_id: 1,
    category_name: "Salud",
    category_color: "#33d17a",
    card: "Visa",
    bank: "Banco",
    person: "Ana",
    notes: "",
    tags: [CUENTA, VIAJE, OCIO],
    is_income: false,
  },
  {
    id: 2,
    date: "2026-10-02",
    description: "Netflix",
    amount: 8000,
    currency: "ARS",
    category_id: 2,
    category_name: "Suscripciones",
    category_color: "#9141ac",
    card: "Visa",
    bank: "Banco",
    person: "Ana",
    notes: "",
    tags: [CUENTA, OCIO],
    is_income: false,
  },
  {
    id: 3,
    date: "2026-10-03",
    description: "Nafta YPF",
    amount: 9500,
    currency: "ARS",
    category_id: 3,
    category_name: "Transporte",
    category_color: "#f5c211",
    card: "Visa",
    bank: "Banco",
    person: "Ana",
    notes: "",
    tags: [CUENTA],
    is_income: false,
  },
];

const CATEGORIES = [
  { id: 1, name: "Salud", color: "#33d17a", parent_id: null },
  { id: 2, name: "Suscripciones", color: "#9141ac", parent_id: null },
  { id: 3, name: "Transporte", color: "#f5c211", parent_id: null },
];

const TAGS = [CUENTA, VIAJE, OCIO];

type BulkCall = { path: string; method: string; body: Record<string, unknown> };

async function openExpenses(page: Page) {
  await seedAuth(page);
  await mockBackend(page, {
    "/categories": CATEGORIES,
    "/tags": TAGS,
    "/expenses/stats": { total: 19000, count: 3, avg: 6333, last_used: null },
    "/expenses/by-category": [],
    "/expenses/by-person": [],
    "/suggestions": [],
  });

  await page.route(/\/api\/expenses(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const search = (url.searchParams.get("search") ?? "").toLowerCase();
    const rows = search
      ? ROWS.filter((row) =>
          `${row.description} ${row.notes} ${row.category_name}`.toLowerCase().includes(search),
        )
      : ROWS;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows),
    });
  });

  const calls: BulkCall[] = [];
  await page.route(/\/api\/expenses\/bulk-(update|tags|delete)$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const path = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    calls.push({ path, method: route.request().method(), body });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        path === "bulk-delete" ? { deleted: (body.ids as number[]).length } : { updated: 2 },
      ),
    });
  });

  await page.goto("/expenses");
  return calls;
}

const bar = (page: Page) =>
  page.getByRole("region", { name: "Acciones para los gastos seleccionados" });
const rowCheckboxes = (page: Page) => page.locator("tbody input[type=checkbox]");

/**
 * The navigation rail expands on hover. Playwright's pointer starts at (0,0),
 * which keeps the rail open and over the first table columns, so park it over
 * the content and let the collapse transition finish before clicking.
 */
async function parkMouse(page: Page) {
  await page.mouse.move(720, 160);
  await page.waitForTimeout(400);
}

async function selectDescriptions(page: Page, descriptions: string[]) {
  await parkMouse(page);
  for (const description of descriptions) {
    await page.getByRole("checkbox", { name: `Seleccionar ${description}` }).check();
  }
}

test("the selector is always visible and selects without a mode", async ({ page }) => {
  await openExpenses(page);

  await expect(page.getByRole("button", { name: "Seleccionar" })).toHaveCount(0);
  await expect(rowCheckboxes(page)).toHaveCount(ROWS.length);

  await selectDescriptions(page, ["Farmacia Central", "Netflix"]);

  await expect(bar(page)).toContainText("2 gastos seleccionados");
  await expect(bar(page)).toContainText(/\$\s?9\.500,00/);
  // The list is still there: no backdrop, no drawer, no navigation.
  await expect(page.getByText("Farmacia Central")).toBeVisible();
  await expect(page.getByText("Nafta YPF")).toBeVisible();
});

test("clicking a row opens the detail and does not select it", async ({ page }) => {
  await openExpenses(page);

  await page.getByText("Farmacia Central").first().click();

  await expect(page.getByRole("dialog", { name: /FARMACIA CENTRAL/i })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test("the header checkbox selects every visible row", async ({ page }) => {
  await openExpenses(page);
  await parkMouse(page);

  await page.getByRole("checkbox", { name: "Seleccionar los gastos visibles" }).check();
  await expect(bar(page)).toContainText("3 gastos seleccionados");

  await page.getByRole("checkbox", { name: "Deseleccionar los gastos visibles" }).uncheck();
  await expect(bar(page)).toHaveCount(0);
});

test("category is applied immediately and clears the selection", async ({ page }) => {
  const calls = await openExpenses(page);
  await selectDescriptions(page, ["Farmacia Central", "Netflix"]);

  await bar(page).getByRole("button", { name: "Categoría" }).click();
  await page.locator("[data-option]").filter({ hasText: "Salud" }).click();

  await expect.poll(() => calls.filter((call) => call.path === "bulk-update").length).toBe(1);
  const categoryCall = calls.find((call) => call.path === "bulk-update")!;
  expect([...(categoryCall.body.ids as number[])].sort((a, b) => a - b)).toEqual([1, 2]);
  expect(categoryCall.body.category_id).toBe(1);
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByText("Categoría actualizada en 2 gastos")).toBeVisible();
});

test("tags stage adds and removes in at most two requests", async ({ page }) => {
  const calls = await openExpenses(page);
  await selectDescriptions(page, ["Farmacia Central", "Netflix"]);

  await bar(page).getByRole("button", { name: "Etiquetas" }).click();
  const picker = page.getByRole("dialog", { name: "Etiquetas de la selección" });
  await expect(picker).toBeVisible();

  // Viaje is on 1 of 2 rows: checking it stages an add.
  await picker.getByRole("checkbox", { name: /Viaje/ }).check();
  // Ocio is on both rows: unchecking it stages a remove.
  await picker.getByRole("checkbox", { name: /Ocio/ }).uncheck();
  await picker.getByRole("button", { name: /^Aplicar/ }).click();

  await expect.poll(() => calls.filter((call) => call.path === "bulk-tags").length).toBe(2);
  const tagCalls = calls.filter((call) => call.path === "bulk-tags");
  expect([...(tagCalls[0].body.ids as number[])].sort((a, b) => a - b)).toEqual([1, 2]);
  expect(tagCalls[0].body.tag_ids).toEqual([20]);
  expect(tagCalls[0].body.mode).toBe("add");
  expect([...(tagCalls[1].body.ids as number[])].sort((a, b) => a - b)).toEqual([1, 2]);
  expect(tagCalls[1].body.tag_ids).toEqual([21]);
  expect(tagCalls[1].body.mode).toBe("remove");
  await expect(bar(page)).toHaveCount(0);
});

test("delete asks for confirmation with the selected count", async ({ page }) => {
  const calls = await openExpenses(page);
  await selectDescriptions(page, ["Farmacia Central", "Netflix"]);

  await bar(page).getByRole("button", { name: "Eliminar" }).click();
  const dialog = page.getByRole("dialog", { name: "Eliminar gastos" });
  await expect(dialog).toContainText("2 gastos");

  await dialog.getByRole("button", { name: "Eliminar" }).click();

  await expect.poll(() => calls.filter((call) => call.path === "bulk-delete").length).toBe(1);
  const deleteCall = calls.find((call) => call.path === "bulk-delete")!;
  expect([...(deleteCall.body.ids as number[])].sort((a, b) => a - b)).toEqual([1, 2]);
  await expect(bar(page)).toHaveCount(0);
});

test("Escape clears the selection", async ({ page }) => {
  await openExpenses(page);
  await selectDescriptions(page, ["Farmacia Central"]);

  await expect(bar(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
});

test("changing a filter clears the selection", async ({ page }) => {
  await openExpenses(page);
  await selectDescriptions(page, ["Farmacia Central"]);
  await expect(bar(page)).toBeVisible();

  await page.getByRole("textbox", { name: "Buscar gastos" }).fill("netflix");

  await expect(page).toHaveURL(/[?&]q=netflix/);
  await expect(bar(page)).toHaveCount(0);
});

test("the description search lives inside the filters section", async ({ page }) => {
  await openExpenses(page);

  const filters = page.getByTestId("expense-filters");
  await expect(filters.getByRole("textbox", { name: "Buscar gastos" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Filtros" })).toBeVisible();
});

test("export selected downloads only the selected rows", async ({ page }) => {
  await openExpenses(page);
  await selectDescriptions(page, ["Farmacia Central"]);

  const downloadPromise = page.waitForEvent("download");
  await bar(page).getByRole("button", { name: "Exportar" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^gastos_seleccionados_/);
});

test("the selection bar has no axe violations", async ({ page }) => {
  await openExpenses(page);
  await selectDescriptions(page, ["Farmacia Central", "Netflix"]);

  const results = await new AxeBuilder({ page })
    .include('[aria-label="Acciones para los gastos seleccionados"]')
    .analyze();

  expect(results.violations).toEqual([]);
});
