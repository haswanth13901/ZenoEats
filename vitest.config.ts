import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Unit and route-handler tests. Node environment — nothing here renders React;
 * the cart logic lives in src/lib/cart.ts precisely so it can be tested as
 * plain functions rather than through a component.
 *
 * Playwright owns the browser-level tests (e2e/), and is excluded here so
 * `vitest` and `playwright test` never try to run each other's files.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    setupFiles: ["tests/setup.ts"],
    // Forks, not threads. The default worker_threads pool deadlocks its RPC
    // ("Timeout calling fetch /@vite/env") on Windows when the project path
    // contains a space — "My Projects" here. Forks are marginally slower to
    // start and completely reliable.
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // The money path and the pure logic behind it. Pages and components are
      // covered by Playwright, and counting them here would inflate the number
      // without telling us anything about correctness.
      include: [
        "src/lib/**/*.ts",
        "src/app/api/**/*.ts",
      ],
      exclude: ["src/lib/supabase*.ts", "src/lib/stripe.ts"],
    },
  },
});
