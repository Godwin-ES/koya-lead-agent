import { test, expect, type Page } from "@playwright/test";
import { createTestUser } from "../../../tests/integration/helpers/db";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("settings", () => {
  test("the display name signs outreach drafts, and shows in the account menu once saved", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/settings");

      const name = page.getByLabel("Name");
      await expect(name).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

      await name.fill("[Your Name]");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "no brackets or placeholders" })).toBeVisible();

      await name.fill("Jordan Reyes");
      await expect(page.getByText(/Best,\s*Jordan Reyes\s*Koya Talent/)).toBeVisible();
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Display name saved")).toBeVisible({ timeout: 10_000 });

      await page.reload();
      await expect(page.getByLabel("Name")).toHaveValue("Jordan Reyes", { timeout: 10_000 });
      await expect(page.getByRole("button", { name: /Jordan Reyes/ })).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });
});
