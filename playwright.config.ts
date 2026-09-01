import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level tests: the auth guards, which span middleware, layout role
 * checks and redirects and so cannot be proven by a unit test.
 *
 * Runs against `next dev`. Cold start here is slow (~60s on Windows), hence
 * the generous webServer timeout; reuseExistingServer means a dev server you
 * already have open is used as-is.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // CI builds first and serves the production output: `next dev` compiles
    // each route on first hit, which is both slow and the source of the
    // empty-body class of flake. Locally dev is fine and gives fast feedback.
    command: process.env.E2E_COMMAND ?? "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
