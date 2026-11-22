import { expect, test, type Page } from "@playwright/test";
import { mockBackend, seedAuth } from "./helpers";
import { LATEST_VERSION } from "../src/data/changes";

/**
 * One smoke path per money-critical flow: import, expense creation, budget
 * setup and inviting a family member. Every request is answered by a route
 * handler, so the specs never read or write production data.
 */

const CATEGORIES = [
  { id: 1, name: "Supermercado", color: "#3584e4", keywords: "" },
  { id: 2, name: "Transporte", color: "#33d17a", keywords: "" },
];

const BUDGET_SUMMARY = {
  month: "2026-11",
  currency: "ARS",
  fx_rate: null,
  fx_rate_date: null,
  fx_rate_source: null,
  total_budget: 300_000,
  total_spent: 120_000,
  total_percentage: 40,
  categories: [
    {
      category_id: 10,
      category_name: "Vivienda",
      category_color: "#3584e4",
      budget_group: "necesidades",
      budget_amount: 200_000,
      spent_amount: 100_000,
      avg_monthly: 90_000,
      months_with_data: 3,
      percentage: 50,
      status: "ok",
      has_budget: true,
      children: [
        {
          category_id: 1,
          category_name: "Supermercado",
          category_color: "#3584e4",
          budget_group: "necesidades",
          budget_amount: 200_000,
          spent_amount: 100_000,
          avg_monthly: 90_000,
          months_with_data: 3,
          percentage: 50,
          status: "ok",
          has_budget: true,
          children: [],
        },
      ],
    },
  ],
  trend_6m: [{ month: "2026-10", total: 100_000 }],
};

const BUDGET_GROUPS = [
  {
    id: 1,
    name: "necesidades",
    display_name: "Necesidades",
    percentage: 50,
    amount: 150_000,
    currency: "ARS",
    spent: 100_000,
    committed: 0,
    available: 50_000,
    alert_thresholds: null,
    categories: [],
    is_active: true,
  },
  {
    id: 2,
    name: "gustos",
    display_name: "Gustos",
    percentage: 30,
    amount: 90_000,
    currency: "ARS",
    spent: 20_000,
    committed: 0,
    available: 70_000,
    alert_thresholds: null,
    categories: [],
    is_active: true,
  },
  {
    id: 3,
    name: "ahorro",
    display_name: "Ahorro",
    percentage: 20,
    amount: 60_000,
    currency: "ARS",
    spent: 0,
    committed: 0,
    available: 60_000,
    alert_thresholds: null,
    categories: [],
    is_active: true,
  },
];

async function openApp(page: Page, path: string, overrides: Record<string, unknown> = {}) {
  await seedAuth(page, { whatsNewDismissedVersion: LATEST_VERSION });
  await mockBackend(page, overrides);
  await page.goto(path);
}

test.describe("critical flows smoke", () => {
  test("import: upload a file, review the preview and confirm it", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "the import entry lives in the desktop sidebar");

    const preview = {
      filename: "resumen.pdf",
      status: "READY_PREVIEW",
      created_at: "2026-11-20T10:00:00Z",
      completed_at: null,
      error_message: null,
      preview_data: {
        rows: [
          {
            date: "10-11-2026",
            description: "Supermercado Coto",
            amount: 15_000,
            currency: "ARS",
            card_header: "",
            transaction_id: null,
            installment_number: null,
            installment_total: null,
            installment_group_id: null,
            suggested_category: "Supermercado",
            is_duplicate: false,
          },
        ],
        raw_count: 1,
        summary: {
          card_type: "crédito",
          bank: "Banco Test",
          closing_date: null,
          due_date: null,
          total_ars: 15_000,
          total_usd: null,
          future_charges_ars: null,
        },
        has_missing_data: false,
        detected_cards: [],
      },
    };

    let uploadBody = "";
    let confirmed = false;

    await openApp(page, "/", { "/categories": CATEGORIES, "/tags": [] });
    await page.route(/\/api\/import-jobs$/, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      uploadBody = route.request().postDataBuffer()?.toString("utf8") ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...preview, status: "PROCESSING" }),
      });
    });
    await page.route(/\/api\/import-jobs\/7$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...preview, id: 7 }),
      }),
    );
    await page.route(/\/api\/import-jobs\/7\/confirm$/, async (route) => {
      confirmed = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ imported: 1, scheduled: 0, skipped: 0 }),
      });
    });

    await page.locator('[data-tour="sidebar-import"]').click();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "resumen.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 e2e"),
      });

    await expect.poll(() => uploadBody).toContain('filename="resumen.pdf"');
    await expect(page.getByText(/resumen\.pdf/).first()).toBeVisible();

    await page.goto("/import-jobs/7");
    await expect(page.getByText("Supermercado Coto")).toBeVisible();
    await page.getByRole("button", { name: "Importar", exact: true }).click();

    await expect(page.getByText("Importación completada")).toBeVisible();
    await expect(page.getByText("Importados")).toBeVisible();
    expect(confirmed).toBe(true);

    await page.getByRole("button", { name: "Ver gastos" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("expense: create one from the modal and send it to the API", async ({ page }) => {
    let created: Record<string, unknown> | null = null;

    await openApp(page, "/expenses", {
      "/categories": CATEGORIES,
      "/tags": [],
      "/expenses/stats": { total: 0, count: 0, avg: 0, last_used: null },
    });
    await page.route(/\/api\/expenses$/, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      created = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 99, ...created }),
      });
    });

    await page.getByRole("button", { name: "Nuevo gasto" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Nuevo gasto" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Monto").fill("4321");
    await dialog.getByPlaceholder("Ej: Supermercado Coto").fill("Supermercado Coto");
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();

    await expect(dialog).toBeHidden();
    expect(created).toMatchObject({
      amount: 4321,
      currency: "ARS",
      description: "Supermercado Coto",
    });
  });

  test("budget: create the 50/30/20 groups from the empty state", async ({ page }) => {
    let created = false;
    let monthlyIncome: string | null = null;

    await openApp(page, "/budget", {
      "/budgets/summary": BUDGET_SUMMARY,
      "/budgets/events": [],
      "/budgets/config": { ahorro_enabled: true },
      "/budgets/suggest": { suggestions: [] },
      "/budgets/groups": [],
    });
    await page.route(/\/api\/budgets\/groups$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(created ? BUDGET_GROUPS : []),
      }),
    );
    await page.route(/\/api\/budgets\/groups\/init(\?.*)?$/, async (route) => {
      created = true;
      monthlyIncome = new URL(route.request().url()).searchParams.get("monthly_income");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(BUDGET_GROUPS),
      });
    });

    await expect(page.getByText("Empezá a controlar tu presupuesto")).toBeVisible();
    await page.getByPlaceholder("500,000").fill("500000");
    await page.getByRole("button", { name: "Crear mi presupuesto" }).click();

    await expect.poll(() => monthlyIncome).toBe("500000");
    await expect(page.getByText("DISPONIBLE", { exact: true })).toBeVisible();
    await expect(page.getByText("Necesidades").first()).toBeVisible();
  });

  test("group: invite a family member with their code", async ({ page }) => {
    let invitation: Record<string, unknown> | null = null;

    await openApp(page, "/");
    await page.route("**/api/groups/invite", async (route) => {
      invitation = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.locator('button[aria-label="Mi cuenta"]:visible').first().click();

    await expect(page.getByRole("heading", { name: "Mi cuenta" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Grupo Familiar" })).toBeVisible();
    await page.getByPlaceholder("Código de invitación", { exact: true }).fill("FAM-1234");
    await page.getByRole("button", { name: "Crear grupo e invitar" }).click();

    await expect(page.getByText("Invitación enviada")).toBeVisible();
    expect(invitation).toEqual({ invite_code: "FAM-1234" });
  });
});
