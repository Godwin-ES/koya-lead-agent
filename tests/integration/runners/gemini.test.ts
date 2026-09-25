import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, serviceRoleClient } from "../helpers/db";
import { runGeminiAgent } from "../../../worker/src/runners/gemini";
import { listToolCallsForRun } from "@core/db/tool-calls";
import { listAgentEventsForRun } from "@core/db/events";
import { LIMIT_DEFAULTS } from "@core/domain/limits";
import { hashObjective } from "@core/domain/normalize";
import { seedEmptyFixtureDiscovery, LAST_ATTEMPT_COUNTERS } from "../helpers/discovery";
import type { ToolRunState } from "@core/tools/log";

/**
 * Runs entirely against recorded fixtures (tests/fixtures/gemini/) - no
 * real Gemini call, per the project-wide constraint that no automated
 * test makes a real external call. The Supabase writes are real (this
 * project's established integration-test pattern, Task 5 onward) but
 * cost nothing.
 */
describe("runGeminiAgent", () => {
  const supabase = serviceRoleClient();
  let userId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.userId;
    cleanup = user.cleanup;
    process.env.REPLAY_MODE = "true";
  });

  afterAll(async () => {
    await cleanup();
  });

  async function createRun(overrides: { objective?: string; maxTurns?: number } = {}) {
    const { data, error } = await supabase
      .from("runs")
      .insert({
        user_id: userId,
        objective_raw: overrides.objective ?? "Find 10 US B2B SaaS ops companies, 10-100 employees",
        status: "running",
        icp: null,
        limits: { ...LIMIT_DEFAULTS, max_turns: overrides.maxTurns ?? LIMIT_DEFAULTS.max_turns },
        counters: LAST_ATTEMPT_COUNTERS,
      })
      .select()
      .single();
    if (error) throw error;
    return data as { id: string; limits: typeof LIMIT_DEFAULTS };
  }

  function toRunState(row: { id: string; limits: typeof LIMIT_DEFAULTS }, objective: string): ToolRunState & { objectiveRaw: string; fixtureSet: string } {
    return {
      id: row.id,
      icp: null,
      limits: row.limits,
      counters: { qualified_count: 0 },
      clarificationCount: 0,
      spentUsd: 0,
      scraper: "crawl4ai",
      objectiveRaw: objective,
      fixtureSet: "unused",
    };
  }

  it("saves the icp before the first discovery call", async () => {
    const run = await createRun({ objective: "B2B SaaS ops tools" });
    await seedEmptyFixtureDiscovery(supabase, run.id);

    const state = { ...toRunState(run, "B2B SaaS ops tools"), fixtureSet: "specific-objective" };
    const result = await runGeminiAgent({ supabase, run: state });

    expect(result.stopReason).toBe("finalized");

    const calls = await listToolCallsForRun(supabase, run.id);
    const seqOf = (name: string) => calls.find((c) => c.tool_name === name)?.seq ?? Infinity;
    expect(seqOf("save_icp")).toBeLessThan(seqOf("discover_companies"));
    // The discovery call must actually succeed against the saved filters, not just be attempted.
    expect(calls.find((c) => c.tool_name === "discover_companies")).toMatchObject({ status: "ok" });
  }, 20_000);

  it("emits an agent event for every tool call", async () => {
    const run = await createRun({ objective: "B2B SaaS ops tools" });
    await seedEmptyFixtureDiscovery(supabase, run.id);

    const state = { ...toRunState(run, "B2B SaaS ops tools"), fixtureSet: "specific-objective" };
    await runGeminiAgent({ supabase, run: state });

    const events = await listAgentEventsForRun(supabase, run.id);
    const toolUseEvents = events.filter((e) => e.type === "tool_use");
    expect(toolUseEvents.length).toBeGreaterThanOrEqual(3); // save_icp, discover_companies, finalize_run
    expect(toolUseEvents.map((e) => (e.payload as { tool: string }).tool)).toEqual(["save_icp", "discover_companies", "finalize_run"]);
  }, 20_000);

  it("stops at the turn limit and finalizes with what it has", async () => {
    const run = await createRun({ objective: "vague objective", maxTurns: 1 });
    const state = { ...toRunState(run, "vague objective"), limits: { ...run.limits, max_turns: 1 }, fixtureSet: "turn-limit" };

    const result = await runGeminiAgent({ supabase, run: state });

    expect(result.stopReason).toBe("max_turns");
    expect(result.turnsUsed).toBe(1);

    const calls = await listToolCallsForRun(supabase, run.id);
    expect(calls.find((c) => c.tool_name === "finalize_run")).toBeDefined();
  }, 20_000);

  // Real bug: Cancel only set status = 'cancelled' and nothing in the
  // worker checked it, so the agent kept running (and spending), and
  // finalize_run could then overwrite the cancel with completed/partial.
  it("stops a cancelled run at the next safe point instead of running on", async () => {
    const run = await createRun({ objective: "B2B SaaS ops tools" });
    await supabase.from("runs").update({ status: "cancelled" }).eq("id", run.id);

    const result = await runGeminiAgent({ supabase, run: { ...toRunState(run, "B2B SaaS ops tools"), fixtureSet: "specific-objective" } });

    expect(result.stopReason).toBe("user_cancelled");
    expect(await listToolCallsForRun(supabase, run.id)).toHaveLength(0);
    const { data } = await supabase.from("runs").select("status").eq("id", run.id).single();
    expect(data!.status).toBe("cancelled");
  }, 20_000);

  it("recovers from one invalid tool input by correcting itself", async () => {
    const run = await createRun({ objective: "recovers test", maxTurns: 2 });
    const state = { ...toRunState(run, "recovers test"), limits: { ...run.limits, max_turns: 2 }, fixtureSet: "recovers-invalid-input" };

    await runGeminiAgent({ supabase, run: state });

    const calls = await listToolCallsForRun(supabase, run.id);
    const saveIcpCalls = calls.filter((c) => c.tool_name === "save_icp");
    expect(saveIcpCalls).toHaveLength(2);
    expect(saveIcpCalls[0]!.status).toBe("error");
    expect(saveIcpCalls[1]!.status).toBe("ok");

    const { data: finalRun } = await supabase.from("runs").select().eq("id", run.id).single();
    expect(finalRun.icp).not.toBeNull();
  }, 20_000);
});
