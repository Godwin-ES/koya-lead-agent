import { test, expect, type Page } from "@playwright/test";
import { createTestUser } from "../../../tests/integration/helpers/db.js";

/**
 * Runs in REPLAY_MODE (the default - see playwright.config.ts and
 * SYSTEM-DESIGN-NEXTJS.md §11) against fixtures recorded once from a
 * real Gemini call for these exact objective texts
 * (tests/fixtures/classifier/objective/). No live model call happens
 * here or on any rerun.
 *
 * Checking is now an explicit "Check objective" click, not a 600ms
 * debounce after typing - every test below clicks it deliberately,
 * matching what a real user now has to do.
 */
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("run intake", () => {
  test("Start run stays disabled until the objective has been checked", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/runs/new");

      const start = page.getByRole("button", { name: "Start run" });
      await page.getByLabel("Qualification objective").fill("Find 10 US fintech companies with 20-80 employees");
      await expect(start).toBeDisabled();

      await page.getByRole("button", { name: "Check objective" }).click();
      await expect(start).toBeEnabled({ timeout: 10_000 });
    } finally {
      await user.cleanup();
    }
  });

  test("editing the objective after a check re-locks Start run until checked again", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/runs/new");

      const objective = page.getByLabel("Qualification objective");
      const start = page.getByRole("button", { name: "Start run" });
      await objective.fill("Find 10 US fintech companies with 20-80 employees");
      await page.getByRole("button", { name: "Check objective" }).click();
      await expect(start).toBeEnabled({ timeout: 10_000 });

      await objective.fill("Find 10 US fintech companies with 20-80 employees, edited");
      await expect(start).toBeDisabled();
    } finally {
      await user.cleanup();
    }
  });

  test("a vague objective is flagged, dismissible, and still starts a run", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/runs/new");

      await page.getByLabel("Qualification objective").fill("find me some tech companies");
      await page.getByRole("button", { name: "Check objective" }).click();
      // getByRole("alert") also matches Next.js's own built-in route
      // announcer, present on every page - scope to the intake flag's
      // own container (see the same fix in auth.spec.ts).
      const flag = page.locator("#objective-flag");
      await expect(flag).toContainText("Missing", { timeout: 10_000 });

      await page.getByRole("button", { name: "Dismiss" }).click();
      const start = page.getByRole("button", { name: "Start run" });
      await expect(start).toBeEnabled();
      await start.click();

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
      await page.getByRole("button", { name: "Check objective" }).click();
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

  test("applying the suggested rewrite clears the flag and requires a fresh check", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/runs/new");

      const objective = page.getByLabel("Qualification objective");
      const flag = page.locator("#objective-flag");
      await objective.fill("find me some tech companies");
      await page.getByRole("button", { name: "Check objective" }).click();
      await expect(flag).toBeVisible({ timeout: 10_000 });

      await page.getByRole("button", { name: "Use this instead" }).click();
      await expect(objective).toHaveValue(/North America/);
      // The flag clears immediately (the field resets validation on any
      // change) and does not reappear once the rewritten text is
      // re-checked and comes back valid.
      await expect(flag).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Start run" })).toBeDisabled();
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

  test("the number of qualified companies to find is the only limit shown", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/runs/new");

      await expect(page.getByLabel("Number of qualified companies to find")).toBeVisible();
      await expect(page.getByLabel("Candidate companies to discover")).toHaveCount(0);
      await expect(page.getByLabel("Websites to scrape")).toHaveCount(0);
      await expect(page.getByLabel("Max agent turns")).toHaveCount(0);
      await expect(page.getByLabel("Max tool calls")).toHaveCount(0);
      await expect(page.getByLabel("Max external spend (USD)")).toHaveCount(0);
      await expect(page.getByTestId("estimated-max-spend")).toHaveCount(0);
    } finally {
      await user.cleanup();
    }
  });
});
