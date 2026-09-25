import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClientAs, createTestUser, serviceRoleClient } from "../helpers/db";
import { LIMIT_DEFAULTS } from "@core/domain/limits";

/**
 * delete_run (migration 025), called as a real signed-in user: removes the
 * run and everything that cascades from it, and refuses while it's running,
 * while a lead in it is being drafted, or when it isn't the caller's.
 */
describe("delete_run", { timeout: 20_000 }, () => {
  const service = serviceRoleClient();
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  let asOwner: SupabaseClient;
  let asOther: SupabaseClient;

  beforeAll(async () => {
    owner = await createTestUser();
    other = await createTestUser();
    asOwner = anonClientAs(owner.accessToken);
    asOther = anonClientAs(other.accessToken);
  });

  afterAll(async () => {
    await owner.cleanup();
    await other.cleanup();
  });

  async function runWithData(status: string) {
    const { data: run, error } = await service
      .from("runs")
      .insert({ user_id: owner.userId, objective_raw: "delete test", status, icp: {}, limits: LIMIT_DEFAULTS, counters: {}, replay_mode: true })
      .select()
      .single();
    if (error) throw error;
    const { data: lead, error: leadError } = await service
      .from("leads")
      .insert({
        run_id: run.id,
        company_name: "Acme",
        company_domain: "acme.example",
        qualification_status: "qualified",
        agent_qualification_status: "qualified",
        confidence: 0.8,
        fit_reasons: ["SaaS: pricing page (acme.example/pricing)"],
        concerns: [],
        source_urls: ["https://acme.example"],
        source_summary: "Acme builds scheduling software.",
      })
      .select()
      .single();
    if (leadError) throw leadError;
    const inserts = await Promise.all([
      service.from("outreach_drafts").insert({ lead_id: lead.id, channel: "linkedin", step: 1, body: "Good day, Acme looks interesting. Open to connecting?", personalization_note: "Acme scheduling (acme.example)" }),
      service.from("tool_calls").insert({ run_id: run.id, seq: 1, tool_name: "save_lead", status: "ok" }),
      service.from("agent_events").insert({ run_id: run.id, seq: 1, type: "assistant_text", payload: { text: "hi" } }),
      service.from("cost_ledger").insert({ run_id: run.id, provider: "apify", unit_type: "result", units: 1, estimated_cost_usd: 0.004 }),
      service.from("run_quality_reports").insert({ run_id: run.id, checks: [], scorecard: [], passed: false, summary: "test" }),
    ]);
    for (const r of inserts) if (r.error) throw r.error;
    return { runId: run.id as string, leadId: lead.id as string };
  }

  async function count(table: string, column: string, value: string) {
    const { count: n, error } = await service.from(table).select("*", { count: "exact", head: true }).eq(column, value);
    if (error) throw error;
    return n;
  }

  it("deletes a stopped run and everything saved for it", async () => {
    const { runId, leadId } = await runWithData("partial");
    const { error } = await asOwner.rpc("delete_run", { p_run_id: runId });
    expect(error).toBeNull();
    expect(await count("runs", "id", runId)).toBe(0);
    expect(await count("leads", "run_id", runId)).toBe(0);
    expect(await count("outreach_drafts", "lead_id", leadId)).toBe(0);
    expect(await count("tool_calls", "run_id", runId)).toBe(0);
    expect(await count("agent_events", "run_id", runId)).toBe(0);
    expect(await count("cost_ledger", "run_id", runId)).toBe(0);
    expect(await count("run_quality_reports", "run_id", runId)).toBe(0);
  });

  it("refuses a running run and leaves it untouched", async () => {
    const { runId } = await runWithData("running");
    const { error } = await asOwner.rpc("delete_run", { p_run_id: runId });
    expect(error?.message).toMatch(/Pause or cancel it/);
    expect(await count("leads", "run_id", runId)).toBe(1);
  });

  it("refuses while a lead in the run is being drafted", async () => {
    const { runId, leadId } = await runWithData("partial");
    await service.from("draft_requests").insert({ run_id: runId, lead_id: leadId, status: "running", replay_mode: true, worker_id: "w1" });
    const { error } = await asOwner.rpc("delete_run", { p_run_id: runId });
    expect(error?.message).toMatch(/being drafted/);
    expect(await count("runs", "id", runId)).toBe(1);
  });

  it("can't delete another user's run", async () => {
    const { runId } = await runWithData("cancelled");
    const { error } = await asOther.rpc("delete_run", { p_run_id: runId });
    expect(error?.message).toMatch(/run not found/);
    expect(await count("runs", "id", runId)).toBe(1);
  });
});
