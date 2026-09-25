import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, serviceRoleClient } from "../helpers/db";
import { claimAndProcessDraftRequest } from "../../../worker/src/drafting";
import { LIMIT_DEFAULTS } from "@core/domain/limits";
import { hashObjective } from "@core/domain/normalize";

/**
 * A reviewer's "draft outreach" request, end to end: the worker claims it
 * and runs a focused session (save_outreach only) from recorded model
 * turns (tests/fixtures/gemini/review-drafting-drafting/), saving all four
 * drafts under the same checks as a full run, signed with the reviewer's
 * display name. $0: no real model or provider call.
 */
const LEAD_ID = "5f0c3f8e-0000-4000-8000-00000000d001";

describe("draft requests", () => {
  const supabase = serviceRoleClient();
  let user: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    process.env.REPLAY_MODE = "true";
    user = await createTestUser();
    await supabase.auth.admin.updateUserById(user.userId, { user_metadata: { display_name: "Jordan Reyes" } });
  });

  afterAll(async () => {
    await user.cleanup();
  });

  it("drafts all four messages for a lead the reviewer qualified, signed with their name", async () => {
    const { data: run, error } = await supabase
      .from("runs")
      .insert({ user_id: user.userId, objective_raw: "drafting test", status: "partial", icp: {}, limits: LIMIT_DEFAULTS, counters: {}, fixture_set: "review-drafting", replay_mode: true })
      .select()
      .single();
    if (error) throw error;

    await supabase.from("leads").delete().eq("id", LEAD_ID);
    const { error: leadError } = await supabase.from("leads").insert({
      id: LEAD_ID,
      run_id: run.id,
      company_name: "NextStage",
      company_domain: "nextstage.ai",
      qualification_status: "qualified",
      agent_qualification_status: "needs_review",
      decided_by: "reviewer",
      review_reason: "Confirmed the team size on their site",
      confidence: 0.7,
      fit_reasons: ["Reviewer: Confirmed the team size on their site"],
      concerns: [],
      source_urls: ["https://nextstage.ai"],
      source_summary: "AI-enabled growth platform for government contractors.",
    });
    if (leadError) throw leadError;
    await supabase.from("scrape_cache").upsert(
      {
        url: "https://nextstage.ai",
        url_hash: hashObjective("https://nextstage.ai"),
        scraper: "crawl4ai",
        content_md:
          "NextStage gives government contractors federal procurement data, pipeline tracking and an AI-Powered Proposal Suite with an AI compliance matrix. Teams keep records current as opportunities move.",
        http_status: 200,
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
      { onConflict: "url_hash" },
    );
    const { data: request, error: requestError } = await supabase.from("draft_requests").insert({ run_id: run.id, lead_id: LEAD_ID, replay_mode: true }).select().single();
    if (requestError) throw requestError;

    const result = await claimAndProcessDraftRequest(supabase, "test-drafter");

    expect(result).toMatchObject({ claimed: true, requestId: request!.id, status: "done" });
    const { data: drafts } = await supabase.from("outreach_drafts").select().eq("lead_id", LEAD_ID).order("channel").order("step");
    expect(drafts!.map((d) => `${d.channel}:${d.step}`)).toEqual(["email:1", "email:2", "email:3", "linkedin:1"]);
    const email1 = drafts!.find((d) => d.channel === "email" && d.step === 1)!;
    expect(email1.body).toMatch(/^Good day,\n\nNextStage gives government contractors/);
    expect(email1.body).toMatch(/\n\nBest,\nJordan Reyes\nKoya Talent$/);
    expect(drafts!.find((d) => d.channel === "linkedin")!.body).toMatch(/^Good day, NextStage's AI compliance matrix/);

    const { data: finished } = await supabase.from("draft_requests").select("status, error, finished_at").eq("id", request!.id).single();
    expect(finished).toMatchObject({ status: "done", error: null });
    expect(finished!.finished_at).not.toBeNull();
    // ~200ms per Supabase round trip from here, and four drafts make dozens of them: 29s measured.
  }, 60_000);

  it("claims nothing when no request is queued for its mode", async () => {
    expect(await claimAndProcessDraftRequest(supabase, "test-drafter")).toEqual({ claimed: false });
  });
});
