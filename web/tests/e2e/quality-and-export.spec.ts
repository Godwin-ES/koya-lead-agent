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

/**
 * Task 19: the quality report and the sample pack are both generated
 * from seeded, real database rows - no live agent run, $0 on every
 * rerun, same discipline as Tasks 17-18.
 */
test.describe("quality report and sample pack", () => {
  test("the quality page renders the seeded finalize_run report", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      const supabase = serviceRoleClient();
      await supabase
        .from("run_quality_reports")
        .update({
          checks: [{ id: "has_ten_qualified", passed: false, detail: "0 of 10 target qualified leads." }],
          scorecard: [{ dimension: "icp_fit", passed: true, note: "ok" }],
          passed: false,
          summary: "Test summary for the quality page.",
        })
        .eq("run_id", run.id);

      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/quality`);

      await expect(page.getByText("Test summary for the quality page.")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/did not pass every quality check/i)).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });

  test("the sample pack renders a qualified lead's evidence and drafts, with a working copy-all button", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      const lead = await seedLead({ runId: run.id, companyName: "Acme Robotics", qualificationStatus: "qualified" });
      await seedDraft({ leadId: lead.id, channel: "email", step: 1, body: "Step one draft body." });

      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/sample-pack`);

      await expect(page.getByRole("heading", { level: 2, name: "Acme Robotics" })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Step one draft body.")).toBeVisible();

      await page.getByRole("button", { name: "Copy all" }).click();
      await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });

  test("the sample pack is a formatted document - subject shown separately, no raw markdown, no stored evidence", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "completed", icp: {} });
      const lead = await seedLead({ runId: run.id, companyName: "Acme Robotics", qualificationStatus: "qualified" });
      await seedDraft({ leadId: lead.id, channel: "email", step: 1, body: "Good day,\n\nAcme Robotics body.\n\nBest,\nJordan Reyes\nKoya Talent" });

      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}/sample-pack`);

      await expect(page.getByRole("heading", { level: 1, name: "Lead sample pack" })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("heading", { level: 2, name: "Acme Robotics" })).toBeVisible();
      await expect(page.getByText("Email 1 of 3")).toBeVisible();
      await expect(page.getByText("Quick question", { exact: true })).toBeVisible();
      await expect(page.getByText(/Incomplete: 2 email steps and the LinkedIn message missing/)).toBeVisible();
      await expect(page.getByText(/\*\*/)).toHaveCount(0);
      await expect(page.getByText("References their hiring signal.")).toHaveCount(0);
    } finally {
      await user.cleanup();
    }
  });
});
