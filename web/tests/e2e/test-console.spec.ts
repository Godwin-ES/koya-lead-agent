import { test, expect, type Page } from "@playwright/test";
import { createTestUser } from "../../../tests/integration/helpers/db";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Task 20: this only exercises the web app's own launch-and-navigate
 * behavior - actually processing the seeded run (and so demonstrating
 * the injected failure itself) needs the worker process, which isn't
 * running during Playwright tests. That path has its own dedicated
 * coverage: tests/integration/failures/injection.test.ts calls
 * claimAndProcessOne() directly against each seeded scenario.
 */
test.describe("test console", () => {
  test("launching a scenario creates a run and navigates to its live view", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/test-console");

      const row = page.getByTestId("scenario-apify_auth_error");
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole("button", { name: "Launch" }).click();

      await expect(page).toHaveURL(/\/runs\/[0-9a-f-]+$/, { timeout: 10_000 });
      // getByText also matches Next.js's own route announcer, present on
      // every page - scoped to the heading, same fix as auth.spec.ts.
      await expect(page.getByRole("heading", { name: /apify_auth_error scenario/i })).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });
});
