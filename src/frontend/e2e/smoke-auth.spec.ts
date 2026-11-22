import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./helpers";

/**
 * Smoke coverage for the three ways into the app: password, Google and
 * Telegram. Everything is answered at the network layer, so no real identity
 * provider, backend or production data is involved.
 */

const ACCESS_TOKEN = { access_token: "e2e-session-token", token_type: "bearer" };

/** Prove the session was persisted, not just that the URL changed. */
async function expectSession(page: Page, token: string) {
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /oikonomia/i })).toBeVisible({
    timeout: 20_000,
  });
  expect(await page.evaluate(() => localStorage.getItem("auth_token"))).toBe(token);
}

test.describe("login smoke", () => {
  test("password login stores the token and lands on the dashboard", async ({ page }) => {
    let credentials: { email?: string; password?: string } | null = null;

    await mockBackend(page);
    await page.route("**/api/auth/login", async (route) => {
      credentials = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ACCESS_TOKEN),
      });
    });

    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill("ana@oikonomia.dev");
    await page.getByLabel("Contraseña").fill("correct-horse");
    await page.getByRole("button", { name: "Ingresar" }).click();

    await expectSession(page, ACCESS_TOKEN.access_token);
    expect(credentials).toEqual({ email: "ana@oikonomia.dev", password: "correct-horse" });
  });

  test("Google login requests a code and the callback starts the session", async ({ page }) => {
    await mockBackend(page);
    await page.route("**/api/auth/oauth/callback", async (route) => {
      const body = route.request().postDataJSON() as { provider?: string; code?: string };
      expect(body).toEqual({ provider: "google", code: "google-one-time" });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ACCESS_TOKEN),
      });
    });

    // The real GIS script is external. Install the smallest client the login
    // button expects and record how it was configured.
    await page.addInitScript(() => {
      const state = {
        requests: 0,
        config: null as {
          client_id?: string;
          scope?: string;
          ux_mode?: string;
          redirect_uri?: string;
        } | null,
      };
      (window as unknown as { __googleAuthSmoke: typeof state }).__googleAuthSmoke = state;
      (window as unknown as { google: unknown }).google = {
        accounts: {
          oauth2: {
            initCodeClient: (config: typeof state.config) => {
              state.config = config;
              return {
                requestCode: () => {
                  state.requests += 1;
                },
              };
            },
          },
        },
      };
    });

    await page.goto("/login");
    await page.getByRole("button", { name: "Continuar con Google" }).click();

    const googleAuth = await page.evaluate(
      () =>
        (
          window as unknown as {
            __googleAuthSmoke: {
              requests: number;
              config: { scope?: string; ux_mode?: string; redirect_uri?: string } | null;
            };
          }
        ).__googleAuthSmoke,
    );
    expect(googleAuth.requests).toBe(1);
    expect(googleAuth.config?.scope).toBe("email profile openid");
    expect(googleAuth.config?.ux_mode).toBe("redirect");
    expect(googleAuth.config?.redirect_uri).toMatch(/\/oauth\/callback$/);

    await page.goto("/oauth/callback?code=google-one-time");

    await expectSession(page, ACCESS_TOKEN.access_token);
  });

  test("Telegram login redirects with state and the callback starts the session", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.route("**/api/auth/telegram/state", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ state: "state-e2e" }),
      }),
    );
    await page.route("**/api/auth/telegram/exchange", async (route) => {
      expect(route.request().postDataJSON()).toEqual({ code: "telegram-one-time" });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ACCESS_TOKEN),
      });
    });
    // Keep the browser on a local stub instead of reaching Telegram.
    await page.route("https://oauth.telegram.org/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Telegram stub</title>",
      }),
    );

    await page.goto("/login");
    const appOrigin = new URL(page.url()).origin;
    await page.getByRole("button", { name: "Continuar con Telegram" }).click();

    await expect(page).toHaveURL(/oauth\.telegram\.org\/auth\?/);
    const authorize = new URL(page.url());
    expect(authorize.searchParams.get("state")).toBe("state-e2e");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${appOrigin}/api/auth/telegram/callback`,
    );

    // The Vite dev server proxies /auth to the backend, so load the SPA first
    // and let the client router take over instead of requesting that URL.
    await page.goto("/login");
    await page.evaluate(() => {
      window.history.pushState({}, "", "/auth/telegram/callback?code=telegram-one-time");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await expectSession(page, ACCESS_TOKEN.access_token);
  });
});
