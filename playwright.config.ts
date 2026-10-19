import { defineConfig, devices } from "@playwright/test";

// UI flows that run on fixtures and sample data (REINS_FIXTURES=1), no database needed.
// It runs against a production build: the dev server reloads pages while tests click.
// `next build` shares .next with `next dev`, so stop the dev server first.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3101";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "REINS_FIXTURES=1 pnpm build && REINS_FIXTURES=1 pnpm exec next start -p 3101",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
