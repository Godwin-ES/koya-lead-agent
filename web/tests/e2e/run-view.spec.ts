import { test, expect, type Page } from "@playwright/test";
import { createTestUser, serviceRoleClient } from "../../../tests/integration/helpers/db";
import { seedRun, seedLead } from "./fixtures/seed";

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

  // Live: the runs list read counters.qualified_count, which is never written, so every run showed 0.
  test("the runs list shows each run's real qualified-lead count", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "partial", icp: {}, objective: "Count check objective" });
      await seedLead({ runId: run.id, companyName: "A Co", companyDomain: "a.example", qualificationStatus: "qualified" });
      await seedLead({ runId: run.id, companyName: "B Co", companyDomain: "b.example", qualificationStatus: "qualified" });
      await seedLead({ runId: run.id, companyName: "C Co", companyDomain: "c.example", qualificationStatus: "needs_review" });
      await signIn(page, user.email, user.password);
      await page.goto("/runs");

      const row = page.getByRole("row", { name: /Count check objective/ });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row.getByRole("cell").nth(2)).toHaveText("2");
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
      // .all() doesn't wait - without this, a cold server can enumerate before the actions render.
      await expect(page.locator("button:disabled").first()).toBeVisible({ timeout: 10_000 });

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

  test("the progress row shows where candidates went, turns and tool calls, and links each outcome to the filtered leads", async ({ page }) => {
    const user = await createTestUser();
    const discovery = (itemCount: number, kept: number) => ({
      toolName: "discover_companies",
      status: "ok" as const,
      resultData: { search: {}, itemCount, candidates: Array.from({ length: kept }, (_, i) => ({ name: `C${i}` })), dropped: [], duplicateCount: 0, cacheHit: false },
    });
    const lead = (domain: string, status: string) => ({ toolName: "save_lead", status: "ok" as const, resultData: { company_domain: domain, qualification_status: status } });
    try {
      const run = await seedRun({
        userId: user.userId,
        status: "running",
        icp: {},
        limits: { target_qualified: 10, scrape_limit: 60 },
        counters: { turns_used: 21, tool_calls_used: 15, scrapes_used: 3 },
        toolCalls: [
          discovery(20, 20),
          discovery(20, 18),
          { toolName: "scrape_site", status: "ok", resultData: { candidateDomain: "a.example", url: "https://a.example" } },
          { toolName: "scrape_site", status: "ok", resultData: { candidateDomain: "b.example", url: "https://b.example" } },
          lead("a.example", "qualified"),
          lead("b.example", "needs_review"),
        ],
      });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}`);

      const progress = page.getByRole("region", { name: "Run progress" });
      await expect(progress).toBeVisible({ timeout: 10_000 });
      await expect(progress).toContainText("Discovered40");
      await expect(progress).toContainText("Kept38");
      await expect(progress).toContainText("Scraped2");
      await expect(progress.getByRole("link", { name: /^Qualified\s*1$/ })).toHaveAttribute("href", `/runs/${run.id}/leads?status=qualified`);
      await expect(progress.getByRole("link", { name: /Needs review\s*1/ })).toHaveAttribute("href", `/runs/${run.id}/leads?status=needs_review`);
      await expect(progress.getByRole("link", { name: /Not qualified\s*0/ })).toBeVisible();
      await expect(progress).toContainText("Turns21");
      await expect(progress).toContainText("Tool calls15");
      await expect(progress.getByText(/\/\s*10\b/)).toHaveCount(0);
      await expect(page.getByText(/\/\s*60\b/)).toHaveCount(0);
      await expect(page.getByText("Spend")).toHaveCount(0);
    } finally {
      await user.cleanup();
    }
  });

  test("each run state offers one way forward: pause while running, resume when paused or failed, run again once finished", async ({ page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user.email, user.password);
      const buttons = async (status: "running" | "paused" | "failed" | "completed", extra: { pauseRequested?: boolean } = {}) => {
        const run = await seedRun({ userId: user.userId, status, failureReason: status === "failed" ? "Gemini rate limit." : undefined, ...extra });
        await page.goto(`/runs/${run.id}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });
        return {
          pause: page.getByRole("button", { name: /^Paus(e|ing…)$/ }),
          resume: page.getByRole("button", { name: "Resume" }),
          runAgain: page.getByRole("button", { name: "Run again" }),
        };
      };

      let b = await buttons("running");
      await expect(b.pause).toBeEnabled();
      await expect(b.resume).toHaveCount(0);
      await expect(b.runAgain).toHaveCount(0);

      b = await buttons("running", { pauseRequested: true });
      await expect(page.getByRole("button", { name: "Pausing…" })).toBeDisabled();
      await expect(page.getByText("Pausing after the current step finishes.")).toBeVisible();

      b = await buttons("paused");
      await expect(b.resume).toBeEnabled();
      await expect(b.runAgain).toHaveCount(0);
      await expect(page.getByText(/Resume continues from where it stopped/)).toBeVisible();

      b = await buttons("failed");
      await expect(b.resume).toBeEnabled();
      await expect(b.runAgain).toHaveCount(0);

      b = await buttons("completed");
      await expect(b.runAgain).toBeEnabled();
      await expect(b.resume).toHaveCount(0);
      await expect(b.pause).toHaveCount(0);
    } finally {
      await user.cleanup();
    }
  });

  test("a partial run says which budget stopped it, and can continue with more searches", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "partial", icp: {}, limits: { target_qualified: 10, max_discover_attempts: 3, candidate_limit: 60, scrape_limit: 120 } });
      await serviceRoleClient()
        .from("runs")
        .update({
          stop_details: {
            limit_reached: "searches", qualified: 6, target: 10, searches_used: 3, searches_limit: 3, kept: 38, undecided: 0,
            scrapes_used: 40, scrape_limit: 120, candidates_seen: 60, candidate_limit: 60, turns_used: 70, max_turns: 150, tool_calls_used: 120, max_tool_calls: 400,
          },
        })
        .eq("id", run.id);
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}`);

      await expect(page.getByText("Stopped at 6 of 10 qualified: all 3 of 3 searches were used, and every one of the 38 companies they kept was evaluated.")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: "Run again" })).toHaveCount(0);

      await page.getByRole("button", { name: "Continue with more budget" }).click();
      await page.getByLabel("Add searches").selectOption("2");
      await expect(page.getByText("up to 40 more companies, about $0.16 on Apify")).toBeVisible();
      await page.getByRole("button", { name: "Continue", exact: true }).click();

      await expect(page.getByRole("button", { name: "Pause" })).toBeVisible({ timeout: 10_000 });
      const { data } = await serviceRoleClient().from("runs").select("status, limits, stop_details").eq("id", run.id).single();
      expect(data).toMatchObject({ status: "queued", stop_details: null, limits: { max_discover_attempts: 5, candidate_limit: 100, scrape_limit: 200 } });
    } finally {
      await user.cleanup();
    }
  });

  test("pausing a queued run pauses it straight away", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({ userId: user.userId, status: "queued" });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}`);

      await page.getByRole("button", { name: "Pause" }).click();
      await expect(page.getByRole("button", { name: "Resume" })).toBeVisible({ timeout: 10_000 });

      const { data } = await serviceRoleClient().from("runs").select("status").eq("id", run.id).single();
      expect(data!.status).toBe("paused");
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

  test("clicking a timeline row expands real detail, not just the one-line summary", async ({ page }) => {
    const user = await createTestUser();
    try {
      const run = await seedRun({
        userId: user.userId,
        status: "running",
        icp: {},
        toolCalls: [
          {
            toolName: "save_icp",
            status: "ok",
            resultSummary: "ICP saved: B2B SaaS Company",
            resultData: {
              target_company_type: "B2B SaaS Company",
              industries: ["Fintech"],
              geography: ["United States"],
              headcount_range: "50-200",
              buyer_persona: "VP of Engineering",
              business_problem: "Manual reconciliation",
              hard_filters: ["US-based"],
              soft_preferences: [],
              disqualifiers: [],
            },
          },
        ],
      });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}`);

      const row = page.getByRole("button", { name: /save_icp/ });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("VP of Engineering")).toHaveCount(0);

      await row.click();
      await expect(page.getByText("VP of Engineering")).toBeVisible();
      await expect(page.getByText("Manual reconciliation")).toBeVisible();

      // Collapses back on a second click.
      await row.click();
      await expect(page.getByText("VP of Engineering")).toHaveCount(0);
    } finally {
      await user.cleanup();
    }
  });

  test("a discover_companies row shows each company's website and LinkedIn links, and why dropped ones were dropped", async ({ page }) => {
    const user = await createTestUser();
    const verdict = (status: string, reason: string) => ({ status, reason });
    const companyData = (name: string, domain: string, prefilter: Record<string, unknown>) => ({
      name,
      domain,
      website: `https://${domain}`,
      linkedinUrl: `https://www.linkedin.com/company/${name.toLowerCase()}/`,
      tagline: `${name} tagline`,
      employeeCountRange: { start: 11, end: 50 },
      industries: [{ id: "4", name: "Software Development" }],
      prefilter,
    });
    try {
      const run = await seedRun({
        userId: user.userId,
        status: "running",
        icp: {},
        toolCalls: [
          {
            toolName: "discover_companies",
            status: "ok",
            resultSummary: "1 kept, 1 dropped, 0 duplicates of 2 returned (pool 130; attempt 1 of 3)",
            resultData: {
              search: { keyword: "platform", industries: [{ id: "4", label: "Software Development" }], locations: ["United States"], companySize: ["11-50"], page: 1 },
              attempt: 1,
              totalResultCount: 130,
              itemCount: 2,
              candidates: [
                companyData("Procare", "procareportal.com", {
                  size: verdict("pass", "ok"),
                  location: verdict("pass", "Headquarters: Chandler, AZ, United States."),
                  concerns: [],
                  dropReason: null,
                }),
              ],
              dropped: [
                companyData("Bigco", "bigco.example", {
                  size: verdict("fail", "LinkedIn size range 201-500 is outside the required 10-100."),
                  location: verdict("pass", "ok"),
                  concerns: [],
                  dropReason: null,
                }),
              ],
              duplicateCount: 0,
              cacheHit: false,
            },
          },
        ],
      });
      await signIn(page, user.email, user.password);
      await page.goto(`/runs/${run.id}`);

      await page.getByRole("button", { name: /discover_companies/ }).click();

      await expect(page.getByText("LinkedIn pool: 130 matching companies", { exact: false })).toBeVisible();
      await expect(page.getByRole("link", { name: "procareportal.com" })).toHaveAttribute("href", "https://procareportal.com");
      await expect(page.getByRole("link", { name: "LinkedIn" }).first()).toHaveAttribute("href", "https://www.linkedin.com/company/procare/");
      await expect(page.getByText("Dropped: LinkedIn size range 201-500 is outside the required 10-100.")).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });
});
