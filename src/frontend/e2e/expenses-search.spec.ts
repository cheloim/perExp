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
    // The real endpoint orders the whole dataset in SQL. Mirror amount and
    // category here so the UI can be checked against a known order.
    const sort = url.searchParams.get("sort");
    const direction = url.searchParams.get("direction") ?? "desc";
    const factor = direction === "asc" ? 1 : -1;
    if (sort === "amount") rows.sort((a, b) => (a.amount - b.amount) * factor);
    if (sort === "category") {
      rows.sort((a, b) => (a.category_name ?? "").localeCompare(b.category_name ?? "") * factor);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows),
    });
  });
  return requests;
}

async function openExpenses(page: Page, extraOverrides: Record<string, unknown> = {}) {
  await seedAuth(page);
  await mockBackend(page, { ...OVERRIDES, ...extraOverrides });
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
  await page.getByRole("button", { name: "Todas las categorías" }).click();

  const listbox = page.getByRole("listbox", { name: "Todas las categorías" });
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

test("a date preset filters the API and survives a reload", async ({ page }) => {
  const requests = await openExpenses(page);

  await page.getByRole("button", { name: /Filtros/ }).click();
  await page.getByTestId("date-range-trigger").click();
  await page.getByRole("button", { name: "3m" }).click();

  await expect(page).toHaveURL(/[?&]range=3m/);

  // The preset is UI state; the request carries concrete dates.
  await expect
    .poll(() => requests.filter((u) => u.searchParams.has("date_from")).length)
    .toBeGreaterThan(0);
  const dated = requests.find((u) => u.searchParams.has("date_from"));
  expect(dated?.searchParams.get("range")).toBeNull();
  expect(dated?.searchParams.get("date_to")).toBeTruthy();

  await page.reload();

  await expect(page).toHaveURL(/[?&]range=3m/);
  await expect(page.getByText("Últimos 3 meses")).toBeVisible();
});

test("clearing the filters is remembered across reloads", async ({ page }) => {
  await openExpenses(page);

  await page.getByRole("button", { name: /Filtros/ }).click();
  await page.getByTestId("date-range-trigger").click();
  await page.getByRole("button", { name: "6m" }).click();
  await expect(page).toHaveURL(/[?&]range=6m/);

  await page.getByRole("button", { name: /^Limpiar \(\d+\)$/ }).click();
  await expect(page).not.toHaveURL(/[?&]range=/);

  await page.reload();
  await expect(page).not.toHaveURL(/[?&]range=/);
});

test("the category analysis links out and no chart request is made", async ({ page }) => {
  const chartRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/expenses/by-category") ||
      request.url().includes("/api/expenses/by-person")
    ) {
      chartRequests.push(request.url());
    }
  });

  await openExpenses(page);

  const link = page.getByRole("link", { name: /Ver análisis por categoría/ });
  await expect(link).toHaveAttribute("href", /\/cat-dashboard\?month=\d{4}-\d{2}/);

  await page.getByRole("button", { name: /Filtros/ }).click();
  await page.getByTestId("date-range-trigger").click();
  await page.getByRole("button", { name: "1m" }).click();

  // `1m` is the current calendar month, so the analysis page inherits it.
  const expectedMonth = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  await expect(link).toHaveAttribute("href", `/cat-dashboard?month=${expectedMonth}`);

  // /expenses has no charts left: neither aggregate is requested.
  expect(chartRequests).toHaveLength(0);
});

test("saved views can be stored and reapplied", async ({ page }) => {
  await openExpenses(page);

  await page.getByRole("button", { name: /Filtros/ }).click();
  await page.getByTestId("date-range-trigger").click();
  await page.getByRole("button", { name: "3m" }).click();
  await expect(page).toHaveURL(/[?&]range=3m/);

  await page.getByRole("button", { name: "Vistas guardadas" }).click();
  const viewsDialog = page.getByRole("dialog", { name: "Vistas guardadas" });
  await viewsDialog.getByRole("textbox", { name: "Nombre de la vista" }).fill("Trimestre");
  await viewsDialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Trimestre", exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Limpiar \(\d+\)$/ }).click();
  await expect(page).not.toHaveURL(/[?&]range=/);

  await page.getByRole("button", { name: "Vistas guardadas" }).click();
  await page.getByRole("button", { name: "Trimestre", exact: true }).click();
  await expect(page).toHaveURL(/[?&]range=3m/);
});

test("the footer says how many of the total are shown", async ({ page }) => {
  await openExpenses(page);

  await expect(page.getByText("3 gastos", { exact: true })).toBeVisible();
});

test("the collapsed filter bar is pinned and the expanded one is not", async ({ page }) => {
  await openExpenses(page);

  const filterCard = page.getByTestId("expense-filters");
  await expect(filterCard).toHaveCSS("position", "sticky");

  await page.getByRole("button", { name: /Filtros/ }).click();
  await expect(filterCard).toHaveCSS("position", "static");
});

test("sortable headers order through the API and expose aria-sort", async ({ page }) => {
  const requests = await openExpenses(page);

  // Description is encrypted at rest: it is a static column, not a sort that
  // would only reorder the rows already loaded. It must not announce a sort.
  const description = page.getByRole("columnheader", { name: "Descripción" });
  await expect(description).not.toHaveAttribute("aria-sort", /ascending|descending/);
  await expect(page.getByRole("button", { name: /Descripción/ })).toHaveCount(0);

  // Amount is visible on mobile too, so the keyboard check runs everywhere.
  const amount = page.getByRole("columnheader", { name: /Monto/ });
  await expect(amount).toHaveAttribute("aria-sort", "none");

  await page.getByRole("button", { name: /Monto/ }).focus();
  await page.keyboard.press("Enter");

  await expect(amount).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(() => requests[requests.length - 1]?.searchParams.get("sort")).toBe("amount");
  expect(requests[requests.length - 1]?.searchParams.get("direction")).toBe("asc");

  await page.getByRole("button", { name: /Monto/ }).click();
  await expect(amount).toHaveAttribute("aria-sort", "descending");
  await expect
    .poll(() => requests[requests.length - 1]?.searchParams.get("direction"))
    .toBe("desc");
});

test("category sort asks the API for the whole dataset", async ({ page }) => {
  const size = page.viewportSize();
  test.skip(!size || size.width < 640, "the category column is hidden on mobile");

  const requests = await openExpenses(page);
  const category = page.getByRole("columnheader", { name: /Categoría/ });

  await page.getByRole("button", { name: /Categoría/ }).click();

  await expect(category).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(() => requests[requests.length - 1]?.searchParams.get("sort")).toBe("category");
  expect(requests[requests.length - 1]?.searchParams.get("direction")).toBe("asc");
});

test("Todo el historial is an explicit period that survives a reload", async ({ page }) => {
  const requests = await openExpenses(page);

  const before = requests.length;
  await page.getByRole("button", { name: "Todo el historial" }).click();

  await expect(page).toHaveURL(/[?&]period=all/);
  await expect(page).not.toHaveURL(/[?&]month=/);
  await expect(page.getByText("Todo el historial")).toBeVisible();

  await expect.poll(() => requests.length).toBeGreaterThan(before);
  // The period is state, not a filter: proving it means the API gets no month.
  expect(requests[requests.length - 1]?.searchParams.get("month")).toBeNull();
  expect(requests[requests.length - 1]?.searchParams.get("date_from")).toBeNull();

  await page.reload();
  await expect(page).toHaveURL(/[?&]period=all/);
  await expect(page.getByText("Todo el historial")).toBeVisible();
});

test("all-history follows the user to the Dashboard", async ({ page }) => {
  await openExpenses(page, {
    "/dashboard/scheduled-summary": { installments: [], manual: [] },
    "/dashboard/summary": {
      total_expenses: 0,
      total_amount: 0,
      total_by_account: 0,
      by_category: [],
      by_income: [],
      by_period: [],
      by_currency: [],
      by_card: [],
      recent_expenses: [],
      trend_data: { history: [], future_installments: {} },
    },
  });
  await page.getByRole("button", { name: "Todo el historial" }).click();
  await expect(page).toHaveURL(/[?&]period=all/);

  await page.goto("/dashboard");

  await expect(page.getByRole("navigation", { name: "Período" })).toContainText(
    "Todo el historial",
  );
});

test("row actions become visible when focused from the keyboard", async ({ page }) => {
  await openExpenses(page);

  const edit = page.getByRole("button", { name: "Editar Farmacia Central" }).first();
  await edit.focus();

  await expect(edit.locator("..")).toHaveCSS("opacity", "1");
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

  const live = page.getByTestId("expense-filters").locator('[aria-live="polite"]');
  await expect(live).toHaveText(/Mostrando 1 de 3 gastos? para «netflix»/);
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
