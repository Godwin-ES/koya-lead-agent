import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createTestUser } from "../../../tests/integration/helpers/db";
import { seedRun, seedLead, seedDraft } from "./fixtures/seed";

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.13: contrast and focus-visible in both
 * themes. axe-core's `wcag2aa` ruleset includes `color-contrast`, which
 * is what actually catches a token that looks fine in one theme but
 * fails contrast in the other - eyeballing screenshots would not. Every
 * run here is seeded via service_role, $0 per rerun.
 */
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function setTheme(page: Page, theme: "light" | "dark") {
  const toggle = page.getByRole("button", { name: /switch to (light|dark) theme/i });
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  const wantLabel = theme === "dark" ? "Switch to dark theme" : "Switch to light theme";
  if ((await toggle.getAttribute("aria-label")) === wantLabel) {
    await toggle.click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme, { timeout: 5_000 });
}

async function runAxe(page: Page) {
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
}

test.describe("accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`the run view has no color-contrast or focus-order violations in ${theme} theme`, async ({ page }) => {
      const user = await createTestUser();
      try {
        const run = await seedRun({ userId: user.userId, status: "completed", icp: {}, counters: { qualified_count: 1 } });
        const lead = await seedLead({ runId: run.id, companyName: "Acme Robotics", qualificationStatus: "qualified" });
        await seedDraft({ leadId: lead.id, channel: "email", step: 1, body: "Step one draft body." });

        await signIn(page, user.email, user.password);
        await page.goto(`/runs/${run.id}`);
        await setTheme(page, theme);

        const results = await runAxe(page);
        const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
      } finally {
        await user.cleanup();
      }
    });

    test(`the leads table has no color-contrast or focus-order violations in ${theme} theme`, async ({ page }) => {
      const user = await createTestUser();
      try {
        const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
        await seedLead({ runId: run.id, companyName: "Acme Robotics", qualificationStatus: "qualified" });

        await signIn(page, user.email, user.password);
        await page.goto(`/runs/${run.id}/leads`);
        await setTheme(page, theme);

        const results = await runAxe(page);
        const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
      } finally {
        await user.cleanup();
      }
    });
  }

  test("focus is visible on the primary action after tabbing from the top of the page", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {}, counters: { qualified_count: 1 } });
      await seedLead({ runId: run.id, companyName: "Acme Robotics", qualificationStatus: "qualified" });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}`);

      const exportButton = page.getByRole("button", { name: "Export sample pack" });
      await exportButton.focus();
      await expect(exportButton).toBeFocused();

      // A real focus-visible outline is a computed outline/box-shadow
      // that isn't `none` - not just DOM focus, which an invisible focus
      // ring would also report as "focused."
      const outlineIsVisible = await exportButton.evaluate((el) => {
        const style = getComputedStyle(el);
        return style.outlineStyle !== "none" || style.boxShadow !== "none";
      });
      expect(outlineIsVisible).toBe(true);
    } finally {
      await user.cleanup();
    }
  });
});
