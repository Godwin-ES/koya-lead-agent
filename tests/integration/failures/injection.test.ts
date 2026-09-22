import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, serviceRoleClient } from "../helpers/db";
import { claimAndProcessOne } from "../../../worker/src/service";
import { LIMIT_DEFAULTS } from "@core/domain/limits";
import { hashObjective } from "@core/domain/normalize";
import type { FailureMode } from "@core/providers/failure-injection";

/**
 * Task 20: one test per wired failure-injection mode
 * (SYSTEM-DESIGN-NEXTJS.md §13's failure table). Every scenario here
 * runs against recorded Gemini fixtures in replay mode - no real
 * provider is ever touched, including the "failure" itself, which is
 * forced by the injection toggle rather than a genuine outage. See
 * packages/core/src/providers/failure-injection.ts's own header comment
 * for which of §13's rows this covers, and why the rest either already
 * have dedicated coverage elsewhere (classifier_outage,
 * malformed-candidate, scrape-404, budget-limit, worker-reclaim,
 * two-workers-one-run) or are scoped out (see BUILD-NOTES-NEXTJS.md).
 */
describe("failure injection", () => {
  const supabase = serviceRoleClient();
  let userId: string;
  let cleanup: () => Promise<void>;
  const previousAllow = process.env.ALLOW_FAILURE_INJECTION;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.userId;
    cleanup = user.cleanup;
    process.env.REPLAY_MODE = "true";
    process.env.ALLOW_FAILURE_INJECTION = "true";
  });

  afterAll(async () => {
    if (previousAllow === undefined) delete process.env.ALLOW_FAILURE_INJECTION;
    else process.env.ALLOW_FAILURE_INJECTION = previousAllow;
    await cleanup();
  });

  // system_errors.run_id is ON DELETE SET NULL, not CASCADE (migration
  // 006, deliberately: an infra-level failure should survive the run it
  // was about that being deleted). That means createTestUser()'s own
  // cascade cleanup never removes the rows these tests insert - each
  // test that expects one must delete it explicitly, by the run id it
  // captured before that id could be nulled out. Same leak class as the
  // scrape_cache one fixed in Task 18.
  async function cleanupSystemErrors(runId: string) {
    await supabase.from("system_errors").delete().eq("run_id", runId);
  }

  async function createRun(opts: { fixtureSet: string; injectedFailure: FailureMode; maxTurns?: number }) {
    const { data, error } = await supabase
      .from("runs")
      .insert({
        user_id: userId,
        objective_raw: "B2B SaaS ops tools",
        status: "queued",
        icp: null,
        limits: { ...LIMIT_DEFAULTS, max_turns: opts.maxTurns ?? LIMIT_DEFAULTS.max_turns },
        counters: {},
        fixture_set: opts.fixtureSet,
        injected_failure: opts.injectedFailure,
      })
      .select()
      .single();
    if (error) throw error;
    return data as { id: string };
  }

  async function fetchRun(id: string) {
    const { data, error } = await supabase.from("runs").select().eq("id", id).single();
    if (error) throw error;
    return data;
  }

  async function fetchSystemErrors(runId: string) {
    const { data, error } = await supabase.from("system_errors").select().eq("run_id", runId);
    if (error) throw error;
    return data;
  }

  it("apify auth/quota error fails the run fast, with a system_errors row", async () => {
    const run = await createRun({ fixtureSet: "specific-objective", injectedFailure: "apify_auth_error" });
    try {
      await claimAndProcessOne(supabase, "test-worker-apify-auth");

      const final = await fetchRun(run.id);
      expect(final.status).toBe("failed");
      expect(final.failure_reason).toMatch(/apify authentication failed/i);

      const errors = await fetchSystemErrors(run.id);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]!.message).toMatch(/apify authentication failed/i);
    } finally {
      await cleanupSystemErrors(run.id);
    }
  }, 20_000);

  it("apify returning 0 candidates still reaches a real partial outcome, not a crash", async () => {
    const run = await createRun({ fixtureSet: "specific-objective", injectedFailure: "apify_empty_result" });

    const result = await claimAndProcessOne(supabase, "test-worker-apify-empty");

    expect(result.stopReason).toBe("finalized");
    const final = await fetchRun(run.id);
    expect(final.status).toBe("partial"); // 0 qualified leads against the default target
  }, 20_000);

  it("crawl4ai sidecar down fails the run with an actionable message", async () => {
    const run = await createRun({ fixtureSet: "failure-injection-scrape", injectedFailure: "sidecar_down", maxTurns: 3 });
    try {
      await claimAndProcessOne(supabase, "test-worker-sidecar-down");

      const final = await fetchRun(run.id);
      expect(final.status).toBe("failed");
      expect(final.failure_reason).toMatch(/crawl4ai health check failed/i);

      const errors = await fetchSystemErrors(run.id);
      expect(errors.length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanupSystemErrors(run.id);
    }
  }, 20_000);

  it("a model 429 fails the run with the provider's reason", async () => {
    const run = await createRun({ fixtureSet: "specific-objective", injectedFailure: "model_429" });
    try {
      await claimAndProcessOne(supabase, "test-worker-model-429");

      const final = await fetchRun(run.id);
      expect(final.status).toBe("failed");
      expect(final.failure_reason).toMatch(/429/);
    } finally {
      await cleanupSystemErrors(run.id);
    }
  }, 20_000);

  it("invalid tool input is returned to the agent as a recoverable error, not a run failure", async () => {
    const run = await createRun({ fixtureSet: "specific-objective", injectedFailure: "invalid_tool_input", maxTurns: 3 });

    const result = await claimAndProcessOne(supabase, "test-worker-invalid-input");

    // The one-shot corruption strikes save_icp, so the icp never gets
    // saved this run - discover_companies is then denied (icp missing),
    // and finalize_run (icp-exempt) still closes the run out normally,
    // proving the whole run survives one bad tool call.
    expect(result.stopReason).toBe("finalized");
    const final = await fetchRun(run.id);
    expect(final.icp).toBeNull();
    expect(final.injected_failure).toBeNull(); // cleared after firing once
  }, 20_000);

  it("a simulated worker kill fails the run with a system_errors row, distinct from a real reclaim", async () => {
    const run = await createRun({ fixtureSet: "specific-objective", injectedFailure: "worker_kill" });
    try {
      await claimAndProcessOne(supabase, "test-worker-kill");

      const final = await fetchRun(run.id);
      expect(final.status).toBe("failed");
      expect(final.failure_reason).toMatch(/simulated worker crash/i);

      const errors = await fetchSystemErrors(run.id);
      expect(errors.length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanupSystemErrors(run.id);
    }
  }, 20_000);

  it("does nothing when ALLOW_FAILURE_INJECTION is not set, even with a run flag present", async () => {
    const previous = process.env.ALLOW_FAILURE_INJECTION;
    delete process.env.ALLOW_FAILURE_INJECTION;
    try {
      const cacheKey = `apify:${hashObjective("B2B SaaS ops tools")}`;
      await supabase.from("discovery_cache").upsert(
        { cache_key: cacheKey, actor_id: "test", input_json: {}, results: [], item_count: 0, expires_at: new Date(Date.now() + 60_000).toISOString() },
        { onConflict: "cache_key" },
      );
      const run = await createRun({ fixtureSet: "specific-objective", injectedFailure: "apify_auth_error" });

      const result = await claimAndProcessOne(supabase, "test-worker-no-injection");

      // With injection disallowed, the real (fixture-driven) path runs
      // instead - the run finalizes normally rather than failing.
      expect(result.stopReason).toBe("finalized");
      const final = await fetchRun(run.id);
      expect(final.status).not.toBe("failed");
    } finally {
      if (previous === undefined) delete process.env.ALLOW_FAILURE_INJECTION;
      else process.env.ALLOW_FAILURE_INJECTION = previous;
    }
  }, 20_000);
});
