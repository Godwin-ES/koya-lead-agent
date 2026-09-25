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

test.describe("leads and review", () => {
  test("a lead page is deep linkable, and back returns to the list", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      const lead = await seedLead({ runId: run.id });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/leads`);

      await page.getByRole("link", { name: /Acme Robotics/ }).click();
      await expect(page).toHaveURL(new RegExp(`/runs/${run.id}/leads/${lead.id}$`));
      await expect(page.getByRole("heading", { level: 1, name: "Acme Robotics" })).toBeVisible();

      await page.goto(`/runs/${run.id}/leads/${lead.id}?tab=evidence`);
      await expect(page.getByRole("link", { name: "Evidence" })).toHaveAttribute("aria-current", "page");

      await page.goBack();
      await expect(page.getByRole("heading", { level: 1, name: "Acme Robotics" })).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });

  test("leads are split by decision - needs_review never mixes with qualified", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      await seedLead({ runId: run.id, companyName: "Qualified Co", companyDomain: "qualified.example", qualificationStatus: "qualified" });
      await seedLead({ runId: run.id, companyName: "Review Co", companyDomain: "review.example", qualificationStatus: "needs_review" });
      await signIn(page, user.email, user.password);

      await page.goto(`/runs/${run.id}/leads`);
      const segments = page.getByRole("navigation", { name: "Lead decisions" });
      await expect(segments.getByRole("link", { name: /Qualified 1/ })).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
      await expect(segments.getByRole("link", { name: /Needs review 1/ })).toBeVisible();
      await expect(page.getByText("Qualified Co")).toBeVisible();
      await expect(page.getByText("Review Co")).toHaveCount(0);

      await page.goto(`/runs/${run.id}/leads?status=needs_review`);
      await expect(page.getByText("Review Co")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Qualified Co")).toHaveCount(0);
    } finally {
      await user.cleanup();
    }
  });

  test("scraped content renders inside a labelled untrusted block on the Evidence tab", async ({ page }) => {
    const user = await createTestUser();
    // scrape_cache is a global url-keyed cache - a unique URL per run, plus cleanup, keeps it clean.
    const url = `https://acme-robotics.example/about-${Date.now()}`;
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      const lead = await seedLead({ runId: run.id, sourceUrls: [url] });
      await serviceRoleClient().from("scrape_cache").insert({ url_hash: `test-${lead.id}`, url, scraper: "crawl4ai", content_md: "# About Acme\nWe build warehouse automation." });

      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/leads/${lead.id}?tab=evidence`);

      await page.locator("details summary", { hasText: url }).click();
      await expect(page.getByText(/untrusted source/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/We build warehouse automation/)).toBeVisible();
    } finally {
      await serviceRoleClient().from("scrape_cache").delete().eq("url", url);
      await user.cleanup();
    }
  });

  test("an injection flagged lead shows its badge in the list", async ({ page }) => {
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

  test("a lead row is reachable and opened by keyboard alone", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      const lead = await seedLead({ runId: run.id });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/leads`);

      const row = page.getByRole("link", { name: /Acme Robotics/ });
      await row.focus();
      await expect(row).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/runs/${run.id}/leads/${lead.id}$`), { timeout: 10_000 });
    } finally {
      await user.cleanup();
    }
  });

  test("qualifying a needs_review lead records your reason, keeps the agent's call, and moves it to Qualified", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "partial", icp: {} });
      const lead = await seedLead({ runId: run.id, companyName: "Review Co", companyDomain: "review.example", qualificationStatus: "needs_review" });
      await serviceRoleClient().from("leads").update({ agent_qualification_status: "needs_review" }).eq("id", lead.id);
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/leads/${lead.id}`);

      await page.getByRole("button", { name: "Qualify only" }).click();
      const save = page.getByRole("button", { name: "Qualify only" }).last();
      await expect(save).toBeDisabled();
      await page.getByLabel("Why does this company qualify?").fill("Their team page lists about 40 staff.");
      await save.click();

      await expect(page.getByText("Your decision: Their team page lists about 40 staff.")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("The agent had marked it needs review.")).toBeVisible();

      await page.goto(`/runs/${run.id}/leads?status=qualified`);
      await expect(page.getByText("Review Co")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Decided by you")).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });

  test("Qualify & draft outreach queues drafting, shown for that lead in the Outreach tab", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "partial", icp: {} });
      const lead = await seedLead({ runId: run.id, companyName: "Review Co", companyDomain: "review.example", qualificationStatus: "needs_review" });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/leads/${lead.id}`);

      await page.getByRole("button", { name: "Qualify & draft outreach" }).click();
      await page.getByLabel("Why does this company qualify?").fill("Confirmed B2B SaaS on their pricing page.");
      await page.getByRole("button", { name: "Qualify & draft outreach" }).last().click();
      await expect(page.getByText("Your decision: Confirmed B2B SaaS on their pricing page.")).toBeVisible({ timeout: 10_000 });

      await page.getByRole("link", { name: /Review this lead's emails and LinkedIn message in Outreach/ }).click();
      await expect(page).toHaveURL(new RegExp(`/runs/${run.id}/outreach\\?lead=${lead.id}$`));
      await expect(page.getByText("Waiting for the worker to start drafting…")).toBeVisible({ timeout: 10_000 });
      const { data } = await serviceRoleClient().from("draft_requests").select("status").eq("lead_id", lead.id).single();
      expect(data!.status).toBe("queued");
    } finally {
      await user.cleanup();
    }
  });

  test("a draft can be edited, reverted to the agent's version, approved and copied", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "partial", icp: {} });
      const lead = await seedLead({ runId: run.id });
      await seedDraft({ leadId: lead.id, channel: "email", step: 1, body: "Good day,\n\nAgent's version.\n\nBest,\nJordan Reyes\nKoya Talent" });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/outreach?lead=${lead.id}`);

      await expect(page.getByText("Agent's version.")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Not drafted yet.")).toHaveCount(3);

      await page.getByRole("button", { name: "Edit" }).click();
      await page.getByLabel("Message").fill("Good day,\n\nMy own version for Acme Robotics.\n\nBest,\nJordan Reyes\nKoya Talent");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("My own version for Acme Robotics.")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Edited by you")).toBeVisible();

      await page.getByRole("button", { name: "Revert to agent's draft" }).click();
      await page.getByRole("button", { name: "Revert", exact: true }).click();
      await expect(page.getByText("Agent's version.")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Edited by you")).toHaveCount(0);

      await page.getByRole("button", { name: "Approve" }).click();
      await expect(page.getByText("Approved", { exact: true })).toBeVisible({ timeout: 10_000 });

      await page.getByRole("button", { name: "Copy" }).click();
      await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });

  test("the Outreach tab reviews one qualified lead at a time, with previous and next", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "partial", icp: {} });
      await seedLead({ runId: run.id, companyName: "First Co", companyDomain: "first.example", qualificationStatus: "qualified" });
      await seedLead({ runId: run.id, companyName: "Second Co", companyDomain: "second.example", qualificationStatus: "qualified" });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}`);

      await page.getByRole("navigation", { name: "Run sections" }).getByRole("link", { name: /Outreach/ }).click();
      const heading = page.getByRole("heading", { level: 2 });
      await expect(heading).toBeVisible({ timeout: 10_000 });
      const first = await heading.textContent();
      await expect(page.getByText("1 of 2")).toBeVisible();

      await page.getByRole("link", { name: "Next" }).click();
      await expect(page.getByText("2 of 2")).toBeVisible({ timeout: 10_000 });
      await expect(heading).not.toHaveText(first!);
    } finally {
      await user.cleanup();
    }
  });
});
