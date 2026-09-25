import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClientAs, createTestUser, serviceRoleClient } from "../helpers/db";
import { LIMIT_DEFAULTS } from "@core/domain/limits";

/**
 * The human-review functions (migration 020), called as a real signed-in
 * user: each checks ownership and changes only what that action may
 * change. Users still have no direct UPDATE on leads or drafts.
 */
describe("human review", () => {
  const service = serviceRoleClient();
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  let asOwner: SupabaseClient;
  let asOther: SupabaseClient;
  let runId: string;

  beforeAll(async () => {
    owner = await createTestUser();
    other = await createTestUser();
    asOwner = anonClientAs(owner.accessToken);
    asOther = anonClientAs(other.accessToken);
    const { data, error } = await service
      .from("runs")
      .insert({ user_id: owner.userId, objective_raw: "review test", status: "partial", icp: {}, limits: LIMIT_DEFAULTS, counters: {} })
      .select()
      .single();
    if (error) throw error;
    runId = data.id;
  });

  afterAll(async () => {
    await owner.cleanup();
    await other.cleanup();
  });

  async function lead(overrides: Record<string, unknown> = {}) {
    const { data, error } = await service
      .from("leads")
      .insert({
        run_id: runId,
        company_name: "Acme",
        company_domain: `acme-${Math.random().toString(36).slice(2, 8)}.example`,
        qualification_status: "needs_review",
        agent_qualification_status: "needs_review",
        confidence: 0.6,
        fit_reasons: [],
        concerns: ["Size range only touches 10-100"],
        source_urls: ["https://acme.example"],
        source_summary: "Acme builds scheduling software.",
        evidence_gap_reason: "Size unclear",
        ...overrides,
      })
      .select()
      .single();
    if (error) throw error;
    return data as { id: string };
  }

  async function draft(leadId: string) {
    const { data, error } = await service
      .from("outreach_drafts")
      .insert({ lead_id: leadId, channel: "email", step: 1, subject: "acme scheduling", body: "Agent body.", personalization_note: "evidence (acme.example)" })
      .select()
      .single();
    if (error) throw error;
    return data as { id: string };
  }

  it("qualifying records the reviewer's decision and keeps the agent's", async () => {
    const l = await lead();
    const { data, error } = await asOwner.rpc("review_lead", { p_lead_id: l.id, p_status: "qualified", p_reason: "Team page shows about 40 staff" }).single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      qualification_status: "qualified",
      agent_qualification_status: "needs_review",
      decided_by: "reviewer",
      review_reason: "Team page shows about 40 staff",
      // The qualified-lead constraint needs a fit reason; the reviewer's own reason becomes one.
      fit_reasons: ["Reviewer: Team page shows about 40 staff"],
    });
  });

  it("refuses another user's lead, a missing reason, and qualifying with no evidence", async () => {
    const l = await lead();
    expect((await asOther.rpc("review_lead", { p_lead_id: l.id, p_status: "qualified", p_reason: "x" }).single()).error?.message).toMatch(/lead not found/);
    expect((await asOwner.rpc("review_lead", { p_lead_id: l.id, p_status: "qualified", p_reason: "  " }).single()).error?.message).toMatch(/reason is required/);

    const bare = await lead({ source_urls: [] });
    expect((await asOwner.rpc("review_lead", { p_lead_id: bare.id, p_status: "qualified", p_reason: "Looks right" }).single()).error?.message).toMatch(/no source pages/);
  });

  it("still gives users no direct write access to leads or drafts", async () => {
    const l = await lead({ qualification_status: "qualified", fit_reasons: ["fits"] });
    const d = await draft(l.id);
    await asOwner.from("leads").update({ fit_reasons: ["forged"] }).eq("id", l.id);
    await asOwner.from("outreach_drafts").update({ body: "forged" }).eq("id", d.id);
    const { data: leadRow } = await service.from("leads").select("fit_reasons").eq("id", l.id).single();
    const { data: draftRow } = await service.from("outreach_drafts").select("body").eq("id", d.id).single();
    expect(leadRow!.fit_reasons).not.toContain("forged");
    expect(draftRow!.body).toBe("Agent body.");
  });

  it("an edit keeps the agent's version and clears approval; revert restores it", async () => {
    const l = await lead({ qualification_status: "qualified", fit_reasons: ["fits"] });
    const d = await draft(l.id);
    await asOwner.rpc("set_draft_approval", { p_draft_id: d.id, p_approved: true }).single();

    const edited = await asOwner.rpc("edit_draft", { p_draft_id: d.id, p_subject: "new subject", p_body: "My body.", p_grounding: { flagged: false }, p_flagged: false }).single();
    expect(edited.error).toBeNull();
    expect(edited.data).toMatchObject({ subject: "new subject", body: "My body.", original_subject: "acme scheduling", original_body: "Agent body.", approved_at: null });

    // A second edit keeps the agent's original, not the first edit.
    await asOwner.rpc("edit_draft", { p_draft_id: d.id, p_subject: "newer", p_body: "Newer body.", p_grounding: { flagged: false }, p_flagged: false }).single();
    const reverted = await asOwner.rpc("revert_draft", { p_draft_id: d.id, p_grounding: { flagged: false }, p_flagged: false }).single();
    expect(reverted.data).toMatchObject({ subject: "acme scheduling", body: "Agent body.", original_body: null, edited_at: null });

    const approved = await asOwner.rpc("set_draft_approval", { p_draft_id: d.id, p_approved: true }).single();
    expect((approved.data as { approved_at: string | null }).approved_at).not.toBeNull();
    expect((await asOther.rpc("set_draft_approval", { p_draft_id: d.id, p_approved: false }).single()).error?.message).toMatch(/draft not found/);
  });

  it("drafting can be requested only for a qualified lead, once at a time", async () => {
    const l = await lead();
    expect((await asOwner.rpc("request_drafts", { p_lead_id: l.id, p_replay_mode: true }).single()).error?.message).toMatch(/only drafted for qualified leads/);

    await asOwner.rpc("review_lead", { p_lead_id: l.id, p_status: "qualified", p_reason: "Confirmed" }).single();
    const first = await asOwner.rpc("request_drafts", { p_lead_id: l.id, p_replay_mode: true }).single();
    const second = await asOwner.rpc("request_drafts", { p_lead_id: l.id, p_replay_mode: true }).single();
    expect(first.error).toBeNull();
    expect((second.data as { id: string }).id).toBe((first.data as { id: string }).id);

    // Not left for the drafting test's worker to pick up.
    await service.from("draft_requests").update({ status: "done" }).eq("lead_id", l.id);
  });
});
