import { serviceRoleClient } from "../../../../tests/integration/helpers/db";
import { LIMIT_DEFAULTS } from "@core/domain/limits";
import type { RunStatus } from "@core/domain/types";

/**
 * Seeds a run (and, on request, its tool_calls/agent_events/leads/
 * outreach_drafts) directly via `service_role` - milliseconds, free,
 * deterministic (SYSTEM-DESIGN-NEXTJS.md §18, Task 17's own cost note:
 * "What's under test here is the UI's behaviour, not the agent's").
 * Never drives a real agent loop.
 */

export interface SeedRunOptions {
  userId: string;
  status: RunStatus;
  objective?: string;
  icp?: Record<string, unknown> | null;
  counters?: Record<string, number>;
  limits?: Record<string, number>;
  failureReason?: string;
  clarificationQuestion?: string;
  /** Sets pause_requested_at - a running run whose Pause hasn't reached a safe point yet. */
  pauseRequested?: boolean;
  toolCalls?: Array<{
    toolName: string;
    status: "ok" | "error" | "denied" | "cache_hit";
    resultSummary?: string;
    denialReason?: string;
    errorMessage?: string;
    durationMs?: number;
    estimatedCostUsd?: number;
    resultData?: unknown;
  }>;
}

export async function seedRun(options: SeedRunOptions) {
  const supabase = serviceRoleClient();
  const needsQualityReport = options.status === "completed" || options.status === "partial";

  // check_completed_requires_quality_report (Task 4) is a BEFORE
  // INSERT OR UPDATE trigger checked against the row's own id - a row
  // can never be inserted directly as 'completed' with no matching
  // run_quality_reports row, and that row can't exist until the run's
  // own id does (its own FK). Insert as 'queued' first, write the
  // report, then update to the real target status - the same
  // insert-then-report-then-transition order finalize_run's own RPC
  // follows for a real run.
  const { data: run, error } = await supabase
    .from("runs")
    .insert({
      user_id: options.userId,
      objective_raw: options.objective ?? "Find 10 US B2B SaaS companies, 10-100 employees",
      status: needsQualityReport ? "queued" : options.status,
      icp: options.icp ?? null,
      counters: options.counters ?? {},
      limits: { ...LIMIT_DEFAULTS, ...options.limits },
      failure_reason: options.failureReason ?? null,
      clarification_question: options.clarificationQuestion ?? null,
      pause_requested_at: options.pauseRequested ? new Date().toISOString() : null,
      queued_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;

  if (needsQualityReport) {
    await supabase.from("run_quality_reports").insert({
      run_id: run.id,
      checks: [],
      scorecard: [],
      passed: options.status === "completed",
      summary: "Seeded for an E2E test - not a real finalize_run report.",
    });
    const { error: updateError } = await supabase.from("runs").update({ status: options.status }).eq("id", run.id);
    if (updateError) throw updateError;
    run.status = options.status;
  }

  let seq = 1;
  for (const call of options.toolCalls ?? []) {
    await supabase.from("tool_calls").insert({
      run_id: run.id,
      seq: seq++,
      tool_name: call.toolName,
      status: call.status,
      result_summary: call.resultSummary ?? null,
      denial_reason: call.denialReason ?? null,
      error_message: call.errorMessage ?? null,
      duration_ms: call.durationMs ?? null,
      estimated_cost_usd: call.estimatedCostUsd ?? null,
      result_data: call.resultData ?? null,
    });
  }

  return run as { id: string };
}

export interface SeedLeadOptions {
  runId: string;
  companyName?: string;
  companyDomain?: string;
  qualificationStatus?: "qualified" | "not_qualified" | "needs_review";
  injectionFlagged?: boolean;
  sourceSummary?: string;
  sourceUrls?: string[];
  fitReasons?: string[];
  concerns?: string[];
}

export async function seedLead(options: SeedLeadOptions) {
  const supabase = serviceRoleClient();
  const isQualified = (options.qualificationStatus ?? "qualified") === "qualified";

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      run_id: options.runId,
      company_name: options.companyName ?? "Acme Robotics",
      company_domain: options.companyDomain ?? "acme-robotics.example",
      qualification_status: options.qualificationStatus ?? "qualified",
      confidence: 0.8,
      fit_reasons: options.fitReasons ?? (isQualified ? ["B2B SaaS", "10-100 employees"] : []),
      concerns: options.concerns ?? [],
      source_urls: options.sourceUrls ?? ["https://acme-robotics.example/about"],
      source_summary: options.sourceSummary ?? "Acme Robotics builds warehouse automation software for logistics teams.",
      injection_flagged: options.injectionFlagged ?? false,
      evidence_gap_reason: isQualified ? null : "Seeded as not qualified for a test.",
    })
    .select()
    .single();
  if (error) throw error;
  return lead as { id: string };
}

export interface SeedDraftOptions {
  leadId: string;
  channel?: "email" | "linkedin";
  step?: 1 | 2 | 3;
  body?: string;
}

export async function seedDraft(options: SeedDraftOptions) {
  const supabase = serviceRoleClient();
  const channel = options.channel ?? "email";
  const { data: draft, error } = await supabase
    .from("outreach_drafts")
    .insert({
      lead_id: options.leadId,
      channel,
      step: options.step ?? 1,
      subject: channel === "email" ? "Quick question" : null,
      body: options.body ?? "I noticed your team is scaling operations - would love to share how we could help.",
      personalization_note: "References their hiring signal.",
      grounding_check: { flagged: false, unsupportedClaims: [] },
    })
    .select()
    .single();
  if (error) throw error;
  return draft as { id: string };
}
