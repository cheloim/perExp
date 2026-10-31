import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockBackend, seedAuth, settleOpenAnimations } from "./helpers";

/**
 * E2E for the /expenses text search (issues #420, #476, #479).
 *
 * Same network-layer stubbing as the assistant specs: no seeded backend. The
 * /api/expenses list gets a smart stub that honors `search` and `category_id`
 * the way the real endpoint does, so the UI → URL → request → render loop is
 * exercised end to end.
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
  tags: unknown[];
  is_income: boolean;
};

const row = (id: number, date: string, description: string, amount: number, cat: string): Row => ({
  id,
  date,
  description,
  amount,
  currency: "ARS",
  category_id: id,
  category_name: cat,
  category_color: "#6366f1",
  card: "",
  bank: "",
  person: "",
  notes: "",
  tags: [],
  is_income: false,
});

const ROWS: Row[] = [
  row(1, "01-10-2026", "Farmacia Central", 1500, "Salud"),
  row(2, "02-10-2026", "Netflix", 8000, "Suscripciones"),
  row(3, "03-10-2026", "Nafta YPF", 9500, "Transporte"),
];

const OVERRIDES = {
  "/expenses/stats": { total: 19000, count: 3, avg: 6333, last_used: null },
  "/expenses/by-category": [
    { category_id: 1, category_name: "Salud", category_color: "#6366f1", total: 1500, count: 1 },
  ],
  "/expenses/by-person": [{ person: "Ana", total: 19000, count: 3 }],
  "/categories": [
    { id: 1, name: "Salud", color: "#6366f1", keywords: "" },
    { id: 2, name: "Suscripciones", color: "#8b5cf6", keywords: "" },
    { id: 3, name: "Transporte", color: "#e66100", keywords: "" },
  ],
};

/** Stub the list endpoint with the real filter contract, recording requests. */
async function mockExpensesList(page: Page) {
  const requests: URL[] = [];
  await page.route(/\/api\/expenses(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const search = (url.searchParams.get("search") ?? "").toLowerCase();
    // Multi-select writes `category_ids`; a single-category link may still
    // arrive as the legacy `category_id`.
    const categoryIds = (
      url.searchParams.get("category_ids") ??
      url.searchParams.get("category_id") ??
      ""
    )
      .split(",")
      .filter(Boolean);
    const rows = ROWS.filter((r) => {
      const haystack = `${r.description} ${r.notes} ${r.category_name}`.toLowerCase();
      return (
        (!search || haystack.includes(search)) &&
        (categoryIds.length === 0 || categoryIds.includes(String(r.category_id)))
      );
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows),
    });
  });
  return requests;
}

async function openExpenses(page: Page) {
  await seedAuth(page);
  await mockBackend(page, OVERRIDES);
  const requests = await mockExpensesList(page);
  await page.goto("/expenses");
  return requests;
}

const searchBox = (page: Page) => page.getByRole("textbox", { name: "Buscar gastos" });

test("typing filters the table and writes q to the URL", async ({ page }) => {
  await openExpenses(page);

  await searchBox(page).fill("netflix");

  await expect(page).toHaveURL(/[?&]q=netflix/);
  await expect(page.getByText(/netflix/i).first()).toBeVisible();
  await expect(page.getByText(/farmacia/i)).toHaveCount(0);
  await expect(page.getByText(/nafta/i)).toHaveCount(0);
});

test("a keystroke burst fires one request, not one per keystroke", async ({ page }) => {
  const requests = await openExpenses(page);

  await searchBox(page).pressSequentially("net", { delay: 20 });
  await expect(page).toHaveURL(/[?&]q=net/);
  await expect.poll(() => requests.filter((u) => u.searchParams.has("search")).length).toBe(1);

  // the debounce would betray itself with intermediate values
  const sent = requests.map((u) => u.searchParams.get("search")).filter((s) => s !== null);
  expect(sent).toEqual(["net"]);
});

test("search combines with other filters (AND)", async ({ page }) => {
  const requests = await openExpenses(page);
  await page.goto("/expenses?q=netflix&category_id=2");

  await expect(page.getByText(/netflix/i).first()).toBeVisible();
  await expect(page.getByText(/farmacia/i)).toHaveCount(0);

  const listRequest = requests.find((u) => u.searchParams.has("search"));
  expect(listRequest?.searchParams.get("search")).toBe("netflix");
  // The legacy single link is normalized to the multi-select contract.
  expect(listRequest?.searchParams.get("category_ids")).toBe("2");
});

test("picking several categories filters the table by all of them", async ({ page }) => {
  const requests = await openExpenses(page);

  await page.getByRole("button", { name: /Filtros/ }).click();
  await page.getByRole("button", { name: "Categoría" }).click();

  const listbox = page.getByRole("listbox", { name: "Categoría" });
  await listbox.getByRole("option", { name: "Salud" }).click();
  await listbox.getByRole("option", { name: "Suscripciones" }).click();

  const results = await new AxeBuilder({ page }).include("#expense-filter-fields").analyze();
  expect(results.violations).toEqual([]);

  await page.keyboard.press("Escape");

  await expect(page).toHaveURL(/[?&]category_ids=1(%2C|,)2/);
  await expect(page.getByText(/farmacia/i).first()).toBeVisible();
  await expect(page.getByText(/netflix/i).first()).toBeVisible();
  await expect(page.getByText(/nafta/i)).toHaveCount(0);

  await expect
    .poll(() => {
      const sent = requests.map((u) => u.searchParams.get("category_ids")).filter(Boolean);
      return sent[sent.length - 1];
    })
    .toBe("1,2");
});

test("the empty state offers to clear the filters, and clearing restores the list", async ({
  page,
}) => {
  await openExpenses(page);

  await searchBox(page).fill("zzz");

  await expect(page.getByText("Sin resultados")).toBeVisible();
  await expect(page.getByText("No hay gastos que coincidan con estos filtros")).toBeVisible();

  await page.getByRole("button", { name: "Limpiar filtros" }).click();

  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(page.getByText(/farmacia/i).first()).toBeVisible();
  await expect(page.getByText(/netflix/i).first()).toBeVisible();
});

test("Limpiar drops the search and the table comes back", async ({ page }) => {
  await openExpenses(page);
  await searchBox(page).fill("netflix");
  await expect(page).toHaveURL(/[?&]q=netflix/);

  await page.getByRole("button", { name: /^Limpiar \(\d+\)$/ }).click();

  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(page.getByText(/farmacia/i).first()).toBeVisible();
});

test("the clear button and Escape empty only the search field", async ({ page }) => {
  await openExpenses(page);
  const box = searchBox(page);

  await box.fill("netflix");
  await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
  await expect(box).toHaveValue("");
  await expect(page).not.toHaveURL(/[?&]q=/);

  await box.fill("nafta");
  await box.press("Escape");
  await expect(box).toHaveValue("");
  await expect(page).not.toHaveURL(/[?&]q=/);
});

test("the result count is announced politely", async ({ page }) => {
  await openExpenses(page);
  await searchBox(page).fill("netflix");

  const live = page.locator('[aria-live="polite"]');
  await expect(live).toHaveText(/1\+? gastos? para «netflix»/);
});

test("CSV export honors the active search", async ({ page }) => {
  const requests = await openExpenses(page);
  await searchBox(page).fill("netflix");
  await expect(page).toHaveURL(/[?&]q=netflix/);

  await page.getByRole("button", { name: /csv/i }).click();

  await expect
    .poll(() => requests.filter((u) => u.searchParams.get("limit") === "10000").length)
    .toBe(1);
  const exported = requests.find((u) => u.searchParams.get("limit") === "10000");
  expect(exported?.searchParams.get("search")).toBe("netflix");
});

test("no axe violations with the search active", async ({ page }) => {
  await openExpenses(page);
  await searchBox(page).fill("netflix");
  await expect(page).toHaveURL(/[?&]q=netflix/);
  await settleOpenAnimations(searchBox(page));

  const results = await new AxeBuilder({ page })
    .include('[aria-label="Buscar gastos"]')
    .include('[aria-live="polite"]')
    .analyze();

  expect(results.violations).toEqual([]);
});
