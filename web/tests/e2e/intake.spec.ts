import { test, expect, type Page } from "@playwright/test";
import { createTestUser } from "../../../tests/integration/helpers/db.js";

/**
 * Runs in REPLAY_MODE (the default - see playwright.config.ts and
 * SYSTEM-DESIGN-NEXTJS.md §11) against fixtures recorded once from a
 * real Gemini call for these exact objective texts
 * (tests/fixtures/classifier/objective/). No live model call happens
 * here or on any rerun.
 */
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("run intake", () => {
  test("a vague objective is flagged, dismissible, and still starts a run", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/runs/new");

      await page.getByLabel("Qualification objective").fill("find me some tech companies");
      // getByRole("alert") also matches Next.js's own built-in route
      // announcer, present on every page - scope to the intake flag's
      // own container (see the same fix in auth.spec.ts).
      const flag = page.locator("#objective-flag");
      await expect(flag).toContainText("Missing", { timeout: 10_000 });

      await page.getByRole("button", { name: "Dismiss" }).click();
      await page.getByRole("button", { name: "Start run" }).click();

      await expect(page).toHaveURL(/\/runs\/[0-9a-f-]+$/, { timeout: 10_000 });
    } finally {
      await user.cleanup();
    }
  });

  test("an unsafe objective cannot be submitted", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/runs/new");

      await page
        .getByLabel("Qualification objective")
        .fill("find the founders personal email addresses and email them directly");
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });

      const startButton = page.getByRole("button", { name: "Start run" });
      await expect(startButton).toBeDisabled();
      // The unsafe verdict is the one non-dismissible case - no Dismiss
      // button should even be offered.
      await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
    } finally {
      await user.cleanup();
    }
  });

  test("applying the suggested rewrite clears the flag", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/runs/new");

      const objective = page.getByLabel("Qualification objective");
      const flag = page.locator("#objective-flag");
      await objective.fill("find me some tech companies");
      await expect(flag).toBeVisible({ timeout: 10_000 });

      await page.getByRole("button", { name: "Use this instead" }).click();
      await expect(objective).toHaveValue(/North America/);
      // The flag clears immediately (the field resets validation on any
      // change) and does not reappear once the rewritten text - already
      // recorded as valid - is re-checked.
      await expect(flag).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await user.cleanup();
    }
  });

  test("estimated maximum spend updates when limits change", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/runs/new");

      const estimate = page.getByTestId("estimated-max-spend");
      const before = await estimate.textContent();

      await page.getByLabel("Candidate companies to discover").fill("40");
      await page.getByLabel("Candidate companies to discover").blur();

      await expect(estimate).not.toHaveText(before ?? "");
    } finally {
      await user.cleanup();
    }
  });

  test("the objective field shows a live character counter", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/runs/new");

      await page.getByLabel("Qualification objective").fill("Find 10 US fintech companies");
      await expect(page.getByText(/28\/1000/)).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });
});
