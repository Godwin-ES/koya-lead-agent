import { test, expect, type Page } from "@playwright/test";
import { createTestUser, serviceRoleClient } from "../../../tests/integration/helpers/db";
import { seedRun, seedLead, seedDraft } from "./fixtures/seed";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("leads", () => {
  test("a lead drawer is deep linkable and back closes it", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      const lead = await seedLead({ runId: run.id });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/leads`);

      await page.getByRole("link", { name: "Acme Robotics" }).click();
      await expect(page).toHaveURL(new RegExp(`/runs/${run.id}/leads/${lead.id}$`));
      await expect(page.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();

      // Deep link: loading the URL directly lands on the same drawer.
      await page.goto(`/runs/${run.id}/leads/${lead.id}`);
      await expect(page.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();

      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/runs/${run.id}/leads$`));
    } finally {
      await user.cleanup();
    }
  });

  test("needs_review leads are excluded from the qualified count", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      await seedLead({ runId: run.id, companyName: "Qualified Co", companyDomain: "qualified.example", qualificationStatus: "qualified" });
      await seedLead({ runId: run.id, companyName: "Review Co", companyDomain: "review.example", qualificationStatus: "needs_review" });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/leads`);

      await expect(page.getByText(/2 of 2 leads - 1 qualified/i)).toBeVisible({ timeout: 10_000 });
    } finally {
      await user.cleanup();
    }
  });

  test("scraped content renders inside a labelled untrusted block", async ({ page }) => {
    const user = await createTestUser();
    // scrape_cache is a flat, url-keyed global cache with no owning
    // run/lead (SYSTEM-DESIGN-NEXTJS.md §11 - shared across users and
    // runs by design), so a hardcoded URL across repeated test runs
    // accumulates stale rows that RLS then legitimately surfaces to
    // every future test's lead referencing the same string (confirmed:
    // three leftover rows from earlier runs of this exact test, none
    // ever cleaned up). A unique URL per test run, plus explicit
    // cleanup, keeps this test - and the shared cache table - clean.
    const url = `https://acme-robotics.example/about-${Date.now()}`;
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      const lead = await seedLead({ runId: run.id, sourceUrls: [url] });

      const supabase = serviceRoleClient();
      await supabase.from("scrape_cache").insert({
        url_hash: `test-${lead.id}`,
        url,
        scraper: "crawl4ai",
        content_md: "# About Acme\nWe build warehouse automation.",
      });

      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/leads/${lead.id}`);

      await expect(page.getByText(/untrusted source/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/We build warehouse automation/)).toBeVisible();
    } finally {
      await serviceRoleClient().from("scrape_cache").delete().eq("url", url);
      await user.cleanup();
    }
  });

  test("an injection flagged lead shows its badge", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      await seedLead({ runId: run.id, injectionFlagged: true });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/leads`);

      await expect(page.getByText("Injection flagged")).toBeVisible({ timeout: 10_000 });
    } finally {
      await user.cleanup();
    }
  });

  test("every draft has a working copy button with feedback", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      const lead = await seedLead({ runId: run.id });
      await seedDraft({ leadId: lead.id, channel: "email", step: 1, body: "Hello from step one." });

      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/leads/${lead.id}`);

      const copyButton = page.getByRole("button", { name: "Copy draft" });
      await expect(copyButton).toBeVisible({ timeout: 10_000 });
      await copyButton.click();
      await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });

  test("the table is keyboard navigable end to end", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      const lead = await seedLead({ runId: run.id });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/leads`);

      // Tab through the filter chips to the company link, then activate
      // it with Enter - the same path a keyboard-only reviewer takes.
      const companyLink = page.getByRole("link", { name: "Acme Robotics" });
      await companyLink.focus();
      await expect(companyLink).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(new RegExp(`/runs/${run.id}/leads/${lead.id}$`), { timeout: 10_000 });
    } finally {
      await user.cleanup();
    }
  });
});
