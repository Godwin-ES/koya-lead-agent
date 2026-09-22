import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@core/db/runs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@core/db/runs")>();
  return { ...actual, heartbeat: vi.fn(actual.heartbeat) };
});

import { heartbeat } from "@core/db/runs";
import { createTestUser, serviceRoleClient } from "../helpers/db";
import { claimAndProcessOne, validateBootCredentials } from "../../../worker/src/service";
import { LIMIT_DEFAULTS } from "@core/domain/limits";

describe("worker lifecycle", () => {
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

  beforeEach(() => {
    vi.mocked(heartbeat).mockClear();
  });

  async function createQueuedRun(overrides: { maxTurns?: number } = {}) {
    const { data, error } = await supabase
      .from("runs")
      .insert({
        user_id: userId,
        objective_raw: "B2B SaaS ops tools",
        status: "queued",
        queued_at: new Date().toISOString(),
        icp: null,
        limits: { ...LIMIT_DEFAULTS, max_turns: overrides.maxTurns ?? LIMIT_DEFAULTS.max_turns },
        counters: {},
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

  it("claims one run at a time and heartbeats while running", async () => {
    const queued = await createQueuedRun();
    await supabase.from("runs").update({ fixture_set: "specific-objective" }).eq("id", queued.id);
    await supabase.from("discovery_cache").upsert(
      {
        cache_key: `apify:${(await import("@core/domain/normalize")).hashObjective("B2B SaaS ops tools")}`,
        actor_id: "test-actor",
        input_json: {},
        results: [],
        item_count: 0,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      { onConflict: "cache_key" },
    );

    const result = await claimAndProcessOne(supabase, "test-worker-1", {
      heartbeatIntervalMs: 200,
    });

    expect(result.claimed).toBe(true);
    expect(result.runId).toBe(queued.id);
    expect(vi.mocked(heartbeat).mock.calls.length).toBeGreaterThanOrEqual(1);

    const run = await fetchRun(queued.id);
    expect(["completed", "partial"]).toContain(run.status);
  }, 20_000);

  it("releases a run to awaiting_input on a clarification request", async () => {
    const queued = await createQueuedRun();
    // fixtureSet is read from the run row's fixture_set column by
    // service.ts - set it directly since createQueuedRun's insert above
    // doesn't take it as a param.
    await supabase.from("runs").update({ fixture_set: "clarification" }).eq("id", queued.id);

    const result = await claimAndProcessOne(supabase, "test-worker-2");

    expect(result.stopReason).toBe("clarification_requested");
    const run = await fetchRun(queued.id);
    expect(run.status).toBe("awaiting_input");
  });

  it("marks a run failed with a reason on an unrecoverable provider error", async () => {
    const queued = await createQueuedRun();
    await supabase.from("runs").update({ fixture_set: "does-not-exist" }).eq("id", queued.id);

    const result = await claimAndProcessOne(supabase, "test-worker-3");

    expect(result.claimed).toBe(true);
    expect(result.stopReason).toBeUndefined();
    const run = await fetchRun(queued.id);
    expect(run.status).toBe("failed");
    expect(run.failure_reason).toMatch(/fixture missing/i);
  });

  it("on sigterm finishes the current tool call, marks the run queued, and exits", async () => {
    const queued = await createQueuedRun();
    await supabase.from("runs").update({ fixture_set: "specific-objective" }).eq("id", queued.id);

    // gemini.ts checks shouldStop() only *after* a tool call has fully
    // committed - always-true here means it stops after exactly one
    // (save_icp), proving the in-flight call's effect survives.
    const result = await claimAndProcessOne(supabase, "test-worker-4", { shouldStop: () => true });

    expect(result.stopReason).toBe("cancelled");
    const run = await fetchRun(queued.id);
    expect(run.status).toBe("queued");
    expect(run.worker_id).toBeNull();
    expect(run.icp).not.toBeNull(); // save_icp's effect was preserved, not discarded
  });

  it("refuses to start when the apify token does not match the expected account", async () => {
    const previous = process.env.APIFY_EXPECTED_ACCOUNT_ID;
    process.env.APIFY_EXPECTED_ACCOUNT_ID = "team-account-123";

    try {
      await expect(
        validateBootCredentials({ checkApifyAccount: async () => "personal-account-456" }),
      ).rejects.toThrow(/team-account-123/);
    } finally {
      if (previous === undefined) delete process.env.APIFY_EXPECTED_ACCOUNT_ID;
      else process.env.APIFY_EXPECTED_ACCOUNT_ID = previous;
    }
  });

  it("passes boot validation when the apify account matches", async () => {
    const previous = process.env.APIFY_EXPECTED_ACCOUNT_ID;
    process.env.APIFY_EXPECTED_ACCOUNT_ID = "team-account-123";

    try {
      await expect(
        validateBootCredentials({ checkApifyAccount: async () => "team-account-123" }),
      ).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.APIFY_EXPECTED_ACCOUNT_ID;
      else process.env.APIFY_EXPECTED_ACCOUNT_ID = previous;
    }
  });
});
