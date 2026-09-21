import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./web/tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production build, not `next dev` - see BUILD-NOTES-NEXTJS.md
    // (Task 6): Turbopack dev mode's HMR WebSocket fails its handshake
    // in this environment, and when it does, client-side event handlers
    // silently never attach at all - confirmed directly (a button click
    // produced zero effect and zero errors under `next dev`, then worked
    // immediately under `next build` + `next start`). A production
    // build is also the more faithful thing to E2E-test regardless.
    command: "pnpm --filter web build && pnpm --filter web start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
