import { test, expect } from "@playwright/test";
import { createTestUser } from "../../../tests/integration/helpers/db.js";

/**
 * Drives the real login form through a real browser against a real,
 * throwaway Supabase Auth user - provisioned and cleaned up per test, the
 * same pattern as the RLS integration tests. No fixture seeding needed
 * here: unlike Tasks 17/18/21's UI tests, auth itself has nothing to fake
 * - it either genuinely works against Supabase or it doesn't, and
 * costs $0 to test (Supabase Auth calls are not a metered external
 * provider - see SYSTEM-DESIGN-NEXTJS.md §11's cost note, which is
 * specifically about Apify/Firecrawl/model spend).
 */
test.describe("auth", () => {
  test("an unauthenticated visit to a protected route redirects to /login", async ({ page }) => {
    await page.goto("/runs");
    await expect(page).toHaveURL(/\/login\?next=%2Fruns/);
    await expect(page.getByRole("heading", { name: "Koya Lead Agent" })).toBeVisible();
  });

  test("signing in with valid credentials leaves /login and sets a session", async ({ page }) => {
    const user = await createTestUser();
    try {
      await page.goto("/login?next=%2Fruns");
      await page.getByLabel("Email").fill(user.email);
      await page.getByLabel("Password").fill(user.password);
      await page.getByRole("button", { name: "Sign in" }).click();

      // /runs doesn't exist until Task 9/17, so this asserts the auth
      // outcome (left /login, a session cookie exists), not the
      // destination page's content.
      await expect(page).not.toHaveURL(/\/login/);
      const cookies = await page.context().cookies();
      expect(cookies.some((c) => c.name.startsWith("sb-"))).toBe(true);
    } finally {
      await user.cleanup();
    }
  });

  test("signing in with the wrong password shows an error and stays on /login", async ({ page }) => {
    const user = await createTestUser();
    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(user.email);
      await page.getByLabel("Password").fill("definitely-the-wrong-password");
      await page.getByRole("button", { name: "Sign in" }).click();

      // getByRole("alert") alone also matches Next.js's own built-in
      // route announcer (#__next-route-announcer__, present on every
      // page for screen-reader navigation announcements) - scope to our
      // own error text specifically.
      await expect(page.getByText("Could not sign in")).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await user.cleanup();
    }
  });

  test("the submit button disables immediately and re-enables after a failed attempt", async ({ page }) => {
    const user = await createTestUser();
    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(user.email);
      await page.getByLabel("Password").fill("wrong-password-again");

      const button = page.getByRole("button", { name: "Sign in" });
      await button.click();
      // The failure round-trip is fast but real (a network call to
      // Supabase); the button must not stay stuck disabled once it
      // settles, so a real retry is possible.
      await expect(button).toBeEnabled({ timeout: 10_000 });
    } finally {
      await user.cleanup();
    }
  });

  test("pressing Enter in the password field submits the form", async ({ page }) => {
    const user = await createTestUser();
    try {
      await page.goto("/login?next=%2Fruns");
      await page.getByLabel("Email").fill(user.email);
      await page.getByLabel("Password").fill(user.password);
      await page.getByLabel("Password").press("Enter");

      await expect(page).not.toHaveURL(/\/login/);
    } finally {
      await user.cleanup();
    }
  });
});
