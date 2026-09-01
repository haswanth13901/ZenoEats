import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "dotenv";

/**
 * Auth guard tests.
 *
 * The anonymous cases need no credentials and always run. The role cases —
 * "a signed-in driver cannot reach the dashboard, an admin can" — need real
 * accounts, so they create two throwaway users through the service-role admin
 * API and delete them afterwards.
 *
 * That writes to a real Supabase project, so it is OFF by default. Set
 * E2E_LIVE_AUTH=1 to include them. Accounts are named e2e-<uuid>@zenoeats.test
 * and removed in teardown; any strays from a crashed run are swept on setup.
 */

let env: Record<string, string> = {};
try {
  env = parse(readFileSync(resolve(process.cwd(), ".env.local")));
} catch {
  /* handled below */
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const liveAuth =
  process.env.E2E_LIVE_AUTH === "1" && Boolean(url && anonKey && serviceKey);

test.describe("anonymous visitors", () => {
  test("/admin redirects to the login page", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("a nested admin route redirects too", async ({ page }) => {
    await page.goto("/admin/orders");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("/admin/alerts redirects", async ({ page }) => {
    await page.goto("/admin/alerts");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("/driver redirects to the login page", async ({ page }) => {
    await page.goto("/driver");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("the login page itself is reachable", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("no order data leaks into the login page", async ({ page }) => {
    const response = await page.goto("/admin/login");
    const body = (await response!.text()).toLowerCase();
    expect(body).not.toContain("customer_phone");
  });

  test("the public menu is still reachable without signing in", async ({ page }) => {
    const response = await page.goto("/menu");
    expect(response!.status()).toBeLessThan(400);
  });
});

test.describe("role guards", () => {
  test.skip(
    !liveAuth,
    "Set E2E_LIVE_AUTH=1 (with .env.local present) to run role tests. They " +
      "create and delete throwaway users in a real Supabase project."
  );

  let admin: SupabaseClient;
  const created: string[] = [];
  const password = "e2e-Test-Password-123!";
  const adminEmail = `e2e-admin-${Date.now()}@zenoeats.test`;
  const driverEmail = `e2e-driver-${Date.now()}@zenoeats.test`;

  test.beforeAll(async () => {
    admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Sweep strays from any previous crashed run before making new ones.
    const { data: existing } = await admin.auth.admin.listUsers();
    for (const user of existing?.users ?? []) {
      if (user.email?.endsWith("@zenoeats.test")) {
        await admin.auth.admin.deleteUser(user.id);
      }
    }

    for (const [email, role] of [
      [adminEmail, "admin"],
      [driverEmail, "driver"],
    ] as const) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`could not create ${role}: ${error?.message}`);

      created.push(data.user.id);
      // The handle_new_user trigger already made the profile row; set the role.
      await admin
        .from("profiles")
        .update({ role, full_name: `E2E ${role}` })
        .eq("id", data.user.id);
    }
  });

  test.afterAll(async () => {
    for (const id of created) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  async function signIn(page: import("@playwright/test").Page, email: string) {
    await page.goto("/admin/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
  }

  test("an admin reaches the dashboard", async ({ page }) => {
    await signIn(page, adminEmail);
    await expect(page).toHaveURL(/\/admin$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  });

  test("a driver signing in lands on the driver view, not the console", async ({
    page,
  }) => {
    await signIn(page, driverEmail);
    await expect(page).toHaveURL(/\/driver$/, { timeout: 30_000 });
    await expect(page.getByText(/your deliveries/i)).toBeVisible();
  });

  test("a signed-in driver navigating to /admin is refused", async ({ page }) => {
    await signIn(page, driverEmail);
    await expect(page).toHaveURL(/\/driver$/, { timeout: 30_000 });

    // Session is real and valid — this proves the admin layout's role check
    // holds on its own, not just the login page's routing.
    await page.goto("/admin");
    await expect(page.getByText(/don't have admin access/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: "Overview" })).toHaveCount(0);
  });

  test("a signed-in driver is refused the alerts page", async ({ page }) => {
    await signIn(page, driverEmail);
    await expect(page).toHaveURL(/\/driver$/, { timeout: 30_000 });

    await page.goto("/admin/alerts");
    await expect(page.getByText(/don't have admin access/i)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("an admin may also view the driver run sheet", async ({ page }) => {
    await signIn(page, adminEmail);
    await expect(page).toHaveURL(/\/admin$/, { timeout: 30_000 });

    await page.goto("/driver");
    await expect(page.getByText(/your deliveries/i)).toBeVisible({ timeout: 30_000 });
  });
});
