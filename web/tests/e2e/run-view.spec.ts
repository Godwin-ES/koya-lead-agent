import { test, expect, type Page } from "@playwright/test";
import { createTestUser, serviceRoleClient } from "../../../tests/integration/helpers/db";
import { seedRun } from "./fixtures/seed";

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.13's testable UI-quality assertions,
 * scoped to the run view (Task 17). Every run here is seeded directly
 * via service_role (see fixtures/seed.ts) - nothing drives a live agent,
 * so this suite costs $0 on every rerun.
 */
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("run view", () => {
  test("double-clicking Start on the intake form creates exactly one run", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      await page.goto("/runs/new");
      await page.getByLabel("Qualification objective").fill("Find 10 US fintech companies with 20-80 employees");
      await page.getByRole("button", { name: "Check objective" }).click();

      const start = page.getByRole("button", { name: "Start run" });
      await expect(start).toBeEnabled({ timeout: 10_000 });

      // A plain `Promise.all([start.click(), start.click()])` does not
      // simulate a true double-click here: Playwright's `.click()` waits
      // for actionability before dispatching, so if the first click's
      // handler disables the button before the second click's own
      // actionability wait resolves, Playwright just waits for it to
      // re-enable and then clicks again - two legitimate sequential
      // clicks, not a real double-click. Dispatching two native clicks
      // in one synchronous browser tick is what a real double-click
      // (and the ref-based guard it's meant to catch) actually looks
      // like.
      await start.evaluate((el: HTMLButtonElement) => {
        el.click();
        el.click();
      });
      await expect(page).toHaveURL(/\/runs\/[0-9a-f-]+$/, { timeout: 10_000 });

      const supabase = serviceRoleClient();
      const { count } = await supabase.from("runs").select("id", { count: "exact", head: true }).eq("user_id", user.userId);
      expect(count).toBe(1);
    } finally {
      await user.cleanup();
    }
  });

  test("every disabled action states its reason", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "queued" });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}`);

      const buttons = await page.getByRole("button").all();
      let checkedAtLeastOne = false;
      for (const button of buttons) {
        if (await button.isDisabled()) {
          const describedBy = await button.getAttribute("aria-describedby");
          expect(describedBy).toBeTruthy();
          checkedAtLeastOne = true;
        }
      }
      expect(checkedAtLeastOne).toBe(true);
    } finally {
      await user.cleanup();
    }
  });

  test("denials render with their reason", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({
        userId: user.userId,
        status: "running",
        icp: { target_company_type: "SaaS" },
        toolCalls: [
          {
            toolName: "scrape_site",
            status: "denied",
            denialReason: "scrape budget exhausted",
          },
        ],
      });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}`);

      await expect(page.getByText(/scrape budget exhausted/i)).toBeVisible({ timeout: 10_000 });
    } finally {
      await user.cleanup();
    }
  });

  test("a budget meter turns red and reads limit reached at 100 percent", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({
        userId: user.userId,
        status: "running",
        limits: { scrape_limit: 5 },
        counters: { scrapes_used: 5 },
      });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}`);

      await expect(page.getByText(/limit reached/i)).toBeVisible({ timeout: 10_000 });
    } finally {
      await user.cleanup();
    }
  });

  test("a failed run shows a persistent inline banner, not a toast", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({
        userId: user.userId,
        status: "failed",
        failureReason: "Gemini returned an invalid response after 3 retries.",
      });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}`);

      const banner = page.getByRole("alert").filter({ hasText: "This run failed" });
      await expect(banner).toBeVisible({ timeout: 10_000 });
      await expect(banner).toContainText("Gemini returned an invalid response");
      // Still visible well after any toast would have auto-dismissed.
      await page.waitForTimeout(3000);
      await expect(banner).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });

  test("a new event does not move the scroll position or steal focus from the timeline", async ({ page }) => {
    const user = await createTestUser();
    try {
      const manyCalls = Array.from({ length: 20 }, (_, i) => ({
        toolName: "scrape_site",
        status: "ok" as const,
        resultSummary: `Scraped page ${i}`,
      }));
      const run = await seedRun({ userId: user.userId, status: "running", icp: {}, toolCalls: manyCalls });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}`);

      const timeline = page.getByRole("region", { name: "Agent tool-call timeline" }).or(page.locator('[aria-label="Agent tool-call timeline"]'));
      await expect(timeline).toBeVisible({ timeout: 10_000 });

      // Scroll to the top, away from the bottom, before a new event
      // arrives. A programmatic `scrollTop` assignment does dispatch a
      // native, non-bubbling `scroll` event, but React's own state
      // update from that event is asynchronous - waiting for the
      // container's `aria-live` region to actually reflect "not at the
      // bottom" (rather than a fixed sleep) is what makes this
      // deterministic instead of racing the test against React.
      await timeline.evaluate((el) => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      // Give React a moment to process that scroll event and update its
      // "am I at the bottom" state before the next assertion depends on
      // it - a fixed short wait, not a poll, since there is no visible
      // DOM signal for that internal state alone.
      await page.waitForTimeout(500);
      const scrollBefore = await timeline.evaluate((el) => el.scrollTop);

      const supabase = serviceRoleClient();
      await supabase.from("tool_calls").insert({
        run_id: run.id,
        seq: 21,
        tool_name: "scrape_site",
        status: "ok",
        result_summary: "A brand new event",
      });

      // Give the realtime insert a moment to land, then assert the
      // scroll position held instead of jumping to the new bottom row.
      await expect(page.getByText(/jump to latest/i)).toBeVisible({ timeout: 10_000 });
      const scrollAfter = await timeline.evaluate((el) => el.scrollTop);
      expect(scrollAfter).toBe(scrollBefore);
    } finally {
      await user.cleanup();
    }
  });
});
