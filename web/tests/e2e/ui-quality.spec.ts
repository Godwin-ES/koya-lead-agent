import { test, expect, type Page } from "@playwright/test";
import { createTestUser } from "../../../tests/integration/helpers/db";
import { seedRun, seedLead, seedDraft } from "./fixtures/seed";

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.13's remaining testable assertions not
 * already covered by run-view.spec.ts (double-submit, action reasons,
 * realtime-vs-scroll) or leads.spec.ts (deep-linkable drawer + Back):
 * throttled-network skeletons, a real error hitting the shared error
 * boundary with a working Retry, and a full create-run-result-to-export
 * path driven by keyboard alone. Every run here is seeded directly via
 * service_role (see fixtures/seed.ts) - nothing drives a live agent, so
 * this suite costs $0 on every rerun, same discipline as the other E2E
 * suites in this project.
 */
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("ui quality", () => {
  test("a throttled connection shows the route's skeleton before real content", async ({ page, context }) => {
    const user = await createTestUser();
    try {
      await seedRun({ userId: user.userId, status: "completed", icp: {} });
      await signIn(page, user.email, user.password);

      // Throttle at the network layer (CDP), not by mocking a route -
      // this exercises the real loading.tsx Suspense boundary against
      // real latency, not a stubbed response.
      const client = await context.newCDPSession(page);
      await client.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 1500,
        downloadThroughput: (50 * 1024) / 8,
        uploadThroughput: (50 * 1024) / 8,
      });

      const navigation = page.goto("/runs");
      await expect(page.getByTestId("table-skeleton")).toBeVisible({ timeout: 5_000 });
      await navigation;

      await client.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await expect(page.getByTestId("table-skeleton")).toHaveCount(0, { timeout: 10_000 });
      await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });

  test("an error loading a run hits the shared error boundary with a working retry", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      // Not a mocked failure: `not-a-valid-uuid` fails Postgres's own
      // `uuid` column validation inside getRunById, a real thrown error
      // that only app/(app)/error.tsx (Task 21) can catch.
      await page.goto("/runs/not-a-valid-uuid");

      // getByRole("alert") also matches Next.js's own built-in route
      // announcer, present on every page - scope to the ErrorState's own
      // message text instead (same fix as auth.spec.ts/intake.spec.ts).
      const alert = page.getByRole("alert").filter({ hasText: /something went wrong loading this page/i });
      await expect(alert).toBeVisible({ timeout: 10_000 });

      const retry = page.getByRole("button", { name: "Retry" });
      await expect(retry).toBeVisible();
      await retry.click();

      // Retrying the same invalid id errors again - what matters is
      // that the boundary itself survives a retry without crashing the
      // whole app shell (the sidebar/topbar stay mounted throughout).
      await expect(page.getByRole("alert").filter({ hasText: /something went wrong loading this page/i })).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByRole("complementary").getByRole("link", { name: "Runs" })).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });

  test("a completed run's results reach the exported sample pack via keyboard alone", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {}, counters: { qualified_count: 1 } });
      const lead = await seedLead({ runId: run.id, companyName: "Acme Robotics", qualificationStatus: "qualified" });
      await seedDraft({ leadId: lead.id, channel: "email", step: 1, body: "Step one draft body." });

      await signIn(page, user.email, user.password);
      await page.goto("/runs");

      // /runs -> run detail, via keyboard only.
      const runLink = page.getByRole("link", { name: run.objective_raw });
      await runLink.focus();
      await expect(runLink).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/runs/${run.id}$`), { timeout: 10_000 });

      // run detail -> sample pack, via keyboard only.
      const exportButton = page.getByRole("button", { name: "Export sample pack" });
      await expect(exportButton).toBeEnabled({ timeout: 10_000 });
      await exportButton.focus();
      await expect(exportButton).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/runs/${run.id}/sample-pack$`), { timeout: 10_000 });

      // sample pack -> copy, via keyboard only.
      await expect(page.getByText("Acme Robotics")).toBeVisible({ timeout: 10_000 });
      const copyAll = page.getByRole("button", { name: "Copy all" });
      await copyAll.focus();
      await expect(copyAll).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });
});
