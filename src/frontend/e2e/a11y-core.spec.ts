import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockBackend, seedAuth, settleOpenAnimations } from "./helpers";

/**
 * Accessibility contract for the four core screens (#550, #551).
 *
 * The backend is stubbed at the network layer, so these run in CI without a
 * seeded database. Only critical axe findings fail the suite: the pre-existing
 * contrast/landmark findings belong to the theme work, not to this contract.
 */

const EXPENSE = {
  id: 1,
  date: "01-10-2026",
  description: "Farmacia Central",
  amount: 1500,
  currency: "ARS",
  category_id: 1,
  category_name: "Salud",
  category_color: "#6366f1",
  card: "",
  bank: "",
  person: "",
  notes: "",
  tags: [],
  is_income: false,
};

const CATEGORY = {
  category_id: 1,
  category_name: "Salud",
  category_color: "#6366f1",
  budget_group: "necesidades",
  currency: "ARS",
  budget_amount: 10000,
  spent_amount: 1500,
  avg_monthly: 1200,
  months_with_data: 6,
  percentage: 15,
  status: "ok",
  has_budget: true,
  children: [],
};

const OVERRIDES = {
  "/expenses": [EXPENSE],
  "/expenses/stats": { total: 1500, count: 1, avg: 1500, last_used: null },
  "/expenses/uncategorized-count": { count: 0 },
  "/categories": [{ id: 1, name: "Salud", color: "#6366f1", keywords: "" }],
  "/tags": [],
  "/dashboard/summary": {
    total_expenses: 1,
    total_amount: 1500,
    total_by_account: 0,
    by_category: [
      { category_id: 1, category_name: "Salud", category_color: "#6366f1", total: 1500, count: 1 },
    ],
    by_income: [],
    by_period: [],
    by_currency: [{ currency: "ARS", total: 1500, count: 1 }],
    by_card: [],
    recent_expenses: [EXPENSE],
    trend_data: { history: [], future_installments: {} },
  },
  "/dashboard/tag-summary": [
    {
      tag_id: 1,
      tag_name: "Visa",
      tag_color: "#6366f1",
      group_name: "cuenta",
      total_amount: 1500,
      count: 1,
      currency: "ARS",
      last_used: null,
      monthly: [],
    },
  ],
  "/dashboard/installments/monthly-load": [],
  "/dashboard/credit-card-pasivos": { total_pasivos: 0, count: 0, pasivos: [] },
  "/dashboard/top-merchants": [],
  "/dashboard/scheduled-summary": { installments: [], manual: [] },
  "/fx/usd-rate": { rate: 1000 },
  "/investments": [],
  "/budgets/summary": {
    month: "2026-11",
    currency: "ARS",
    total_budget: 10000,
    total_spent: 1500,
    total_percentage: 15,
    categories: [
      {
        category_id: 10,
        category_name: "Salud",
        category_color: "#6366f1",
        budget_group: "necesidades",
        budget_amount: 0,
        spent_amount: 0,
        avg_monthly: 0,
        months_with_data: 6,
        percentage: 0,
        status: "no_budget",
        has_budget: false,
        children: [CATEGORY],
      },
    ],
    trend_6m: [],
  },
  "/budgets/groups": [
    {
      id: 1,
      name: "necesidades",
      display_name: "Necesidades",
      percentage: 50,
      amount: 10000,
      currency: "ARS",
      spent: 1500,
      committed: 0,
      available: 8500,
      alert_thresholds: [0.8],
      categories: [],
      is_active: true,
    },
  ],
  "/budgets/events": [
    {
      id: 1,
      name: "Vacaciones",
      start_date: "2026-11-01",
      end_date: "2026-11-30",
      total_amount: 50000,
      spent: 1500,
      categories: [],
      is_active: true,
    },
  ],
  "/budgets/config": { ahorro_enabled: false },
  "/budgets/suggest": { suggestions: [] },
};

async function open(page: Page, path: string) {
  await seedAuth(page);
  await mockBackend(page, OVERRIDES);
  await page.goto(path);
  await page.locator("h1").first().waitFor({ timeout: 20_000 });
}

async function expectNoCriticalAxe(page: Page) {
  const root =
    (await page.locator("main").count()) > 0 ? page.locator("main") : page.locator("body");
  await settleOpenAnimations(root);
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter((v) => v.impact === "critical");
  expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
}

test.describe("core screens", () => {
  test("Dashboard has no critical axe violations", async ({ page }) => {
    await open(page, "/");
    await expectNoCriticalAxe(page);
  });

  test("Gastos has no critical axe violations", async ({ page }) => {
    await open(page, "/expenses");
    await expectNoCriticalAxe(page);
  });

  test("Presupuesto has no critical axe violations", async ({ page }) => {
    await open(page, "/budget");
    await expectNoCriticalAxe(page);
  });

  test("Login has no critical axe violations", async ({ page }) => {
    await mockBackend(page, OVERRIDES);
    await page.goto("/login");
    await page.getByRole("heading", { name: /oikonomia/i }).waitFor({ timeout: 20_000 });
    await expectNoCriticalAxe(page);
  });
});

test("a row opens, edits and saves with the keyboard only", async ({ page }) => {
  await open(page, "/expenses");
  const putRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/api/expenses/")) {
      putRequests.push(request.url());
    }
  });

  const openRow = page.getByRole("button", { name: "Abrir detalle de Farmacia Central" });
  await openRow.focus();
  await page.keyboard.press("Enter");

  const detail = page.getByRole("dialog", { name: "FARMACIA CENTRAL" });
  await expect(detail).toBeVisible();
  await settleOpenAnimations(detail);
  const detailAxe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(detailAxe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);

  // Walk the dialog with Tab until the edit action owns focus.
  const editButton = page.getByRole("button", { name: "Editar", exact: true });
  for (
    let i = 0;
    i < 6 && !(await editButton.evaluate((el) => el === document.activeElement));
    i++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(editButton).toBeFocused();
  await page.keyboard.press("Enter");

  const editor = page.getByRole("dialog", { name: "Editar gasto" });
  await expect(editor).toBeVisible();
  await settleOpenAnimations(editor);
  const editorAxe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(editorAxe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
  const amount = editor.getByLabel(/^Monto/);
  await amount.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("1800");

  const save = editor.getByRole("button", { name: "Guardar" });
  await save.focus();
  await page.keyboard.press("Enter");

  await expect(editor).toHaveCount(0);
  await expect.poll(() => putRequests.length).toBe(1);
});

test("closing a budget dialog returns focus to its trigger", async ({ page }) => {
  await open(page, "/budget");
  const trigger = page.getByRole("button", { name: "Editar presupuesto de Salud" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Salud" });
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
