"use server";

import { createClient } from "@/lib/supabase/server";
import { insertRun, listRunsForUser, getRunById, updateRun, requestPause } from "@core/db/runs";
import { listLeadsForRun } from "@core/db/leads";
import { validateObjective } from "@core/validation/objective";
import { clampLimits, deriveLimitsFromTarget, extendLimits, searchesLeftToAdd } from "@core/domain/limits";
import { deriveRunActions } from "@core/domain/run-actions";
import type { RunCounters, RunLimits, Runner, Scraper } from "@core/domain/types";
import type { RunRow } from "@core/db/row-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReplayMode } from "@core/providers/replay/recorder";
import { errorMessage } from "@core/domain/errors";
import { isProduction, productionRunConfig } from "@core/domain/environment";
import { revalidatePath } from "next/cache";

export interface CreateRunInput {
  objectiveText: string;
  /** The only limit the client can express - every other limit is derived from it server-side, never trusted from the client. */
  targetQualified: number;
  runner: Runner;
  model?: string;
  scraper: Scraper;
  /** Whether the user dismissed a validation flag before submitting. */
  dismissed: boolean;
  /** Generated once by ActionButton, stable across retries of this one intent. */
  idempotencyKey: string;
}

export interface CreateRunResult {
  runId?: string;
  error?: string;
}

/**
 * SYSTEM-DESIGN-NEXTJS.md §9 Step 3: re-validates regardless of what the
 * client reported (a client-side check is UX, never the enforcement -
 * §7.1), refuses a confidently unsafe objective server-side, derives every
 * limit but `target_qualified` here from scratch
 * (packages/core/src/domain/limits.ts's deriveLimitsFromTarget) rather
 * than accepting them from the client - hiding a field in the UI isn't
 * the same as enforcing it, and a client could otherwise still POST
 * arbitrary candidate_limit/scrape_limit/max_spend_usd values directly -
 * and is idempotent on the client-generated key.
 */
export async function createRun(input: CreateRunInput): Promise<CreateRunResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in." };
  }

  const { data: existing } = await supabase
    .from("runs")
    .select("id")
    .eq("user_id", user.id)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle<Pick<RunRow, "id">>();
  if (existing) {
    return { runId: existing.id };
  }

  const validation = await validateObjective(supabase, input.objectiveText, user.id);
  if (validation.blocking) {
    return { error: validation.reason || "This objective asks for something outside this tool's scope." };
  }

  const limits = deriveLimitsFromTarget(input.targetQualified);

  const run = await insertRun(supabase, {
    user_id: user.id,
    objective_raw: input.objectiveText,
    status: "queued",
    // Production ignores what the request asks for (see productionRunConfig).
    ...(isProduction() ? productionRunConfig() : { runner: input.runner, model: input.model, scraper: input.scraper }),
    // Recorded so only a worker in the same mode claims it - see migration 019.
    replay_mode: isReplayMode(),
    limits,
    validation_verdict: validation.verdict,
    validation_reason: validation.reason,
    validation_confidence: validation.confidence ?? undefined,
    validation_missing_criteria: validation.missingCriteria,
    validation_dismissed_at: input.dismissed ? new Date().toISOString() : undefined,
    idempotency_key: input.idempotencyKey,
    queued_at: new Date().toISOString(),
  });

  return { runId: run.id };
}

/**
 * The signed-in user's runs, each with its qualified-lead count. The count
 * comes from `leads` - `counters.qualified_count` is never written (it's
 * always derived, so it can't drift), and reading it showed 0 for every run.
 */
export async function listMyRuns(): Promise<Array<RunRow & { qualifiedCount: number }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const runs = await listRunsForUser(supabase, user.id);
  if (runs.length === 0) return [];

  const { data, error } = await supabase
    .from("leads")
    .select("run_id")
    .eq("qualification_status", "qualified")
    .in(
      "run_id",
      runs.map((r) => r.id),
    );
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ run_id: string }>) counts.set(row.run_id, (counts.get(row.run_id) ?? 0) + 1);
  return runs.map((r) => ({ ...r, qualifiedCount: counts.get(r.id) ?? 0 }));
}

export interface RunActionResult {
  error?: string;
}

async function currentUserId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * RLS (Task 4) already prevents a mutation from touching another user's
 * row - a scoped update simply affects zero rows. This check exists so
 * every action below can return a clear "not found" instead of a
 * silent no-op, and so `deriveRunActions` (the same function the UI
 * used to decide whether to even show the control) gets a real run to
 * evaluate before the server commits to anything (SYSTEM-DESIGN-NEXTJS.md
 * §17.5: "the server cannot reject an action the UI presented as
 * available - they are the same decision").
 */
async function requireOwnedRun(supabase: SupabaseClient, runId: string, userId: string): Promise<RunRow | null> {
  const run = await getRunById(supabase, runId);
  if (!run || run.user_id !== userId) return null;
  return run;
}

async function actionStateFor(supabase: SupabaseClient, run: RunRow) {
  const leadCount = (await listLeadsForRun(supabase, run.id)).length;
  return deriveRunActions({
    status: run.status,
    counters: { qualified_count: 0, ...(run.counters as Record<string, number>) } as RunCounters,
    lead_count: leadCount,
    pause_requested: run.pause_requested_at !== null,
    limit_reached: run.stop_details?.limit_reached ?? null,
    searches_left_to_add: searchesLeftToAdd(run.limits),
  });
}

/**
 * "Continue with more budget": a partial run gets more searches (and
 * whatever budget actually stopped it), then goes back in the queue as the
 * same run. The worker continues it from the handover note - its leads,
 * drafts, and every company already seen are kept, so nothing is redone.
 */
export async function extendRun(runId: string, extraSearches: number): Promise<RunActionResult> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { error: "Not signed in." };

  const run = await requireOwnedRun(supabase, runId, userId);
  if (!run) return { error: "Run not found." };

  const actions = await actionStateFor(supabase, run);
  if (actions.extend.kind !== "enabled") {
    return { error: actions.extend.kind === "disabled" ? actions.extend.reason : "This run can't be continued." };
  }

  const limits = extendLimits(run.limits as RunLimits, extraSearches, run.stop_details?.limit_reached ?? null);
  await updateRun(supabase, runId, {
    limits,
    status: "queued",
    queued_at: new Date().toISOString(),
    finished_at: null,
    partial_reason: null,
    stop_details: null,
    replay_mode: isReplayMode(),
  });
  return {};
}

/** §17.4: cancelling is a destructive/expensive action - the UI confirms before calling this; this still re-checks server-side regardless. */
export async function cancelRun(runId: string): Promise<RunActionResult> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { error: "Not signed in." };

  const run = await requireOwnedRun(supabase, runId, userId);
  if (!run) return { error: "Run not found." };

  const actions = await actionStateFor(supabase, run);
  if (actions.cancel.kind !== "enabled") {
    return { error: actions.cancel.kind === "disabled" ? actions.cancel.reason : "This run cannot be cancelled." };
  }

  await updateRun(supabase, runId, { status: "cancelled" });
  return {};
}

/**
 * Delete a run and everything saved for it - leads, drafts, the timeline,
 * cost records and the quality report all cascade from the run row. The
 * delete_run RPC re-checks, under a row lock, that no worker is running the
 * run or drafting for one of its leads.
 */
export async function deleteRun(runId: string): Promise<RunActionResult> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { error: "Not signed in." };

  const run = await requireOwnedRun(supabase, runId, userId);
  if (!run) return { error: "Run not found." };

  const actions = await actionStateFor(supabase, run);
  if (actions.delete.kind !== "enabled") {
    return { error: actions.delete.kind === "disabled" ? actions.delete.reason : "This run cannot be deleted." };
  }

  const { error } = await supabase.rpc("delete_run", { p_run_id: runId });
  if (error) return { error: errorMessage(error) };

  revalidatePath("/runs");
  return {};
}

/**
 * Pause. A queued run pauses immediately; a running one finishes its
 * current step first (the worker checks between steps), so the UI shows
 * "Pausing…" until the worker sets status 'paused'.
 */
export async function pauseRun(runId: string): Promise<RunActionResult> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { error: "Not signed in." };

  const run = await requireOwnedRun(supabase, runId, userId);
  if (!run) return { error: "Run not found." };

  const actions = await actionStateFor(supabase, run);
  if (actions.pause.kind !== "enabled") {
    return { error: actions.pause.kind === "disabled" ? actions.pause.reason : "This run cannot be paused." };
  }

  if (!(await requestPause(supabase, runId))) return { error: "The run changed state before it could be paused - refresh and try again." };
  return {};
}

/**
 * Resume a paused or failed run: back into the queue as the same run. The
 * worker that picks it up starts the agent with a handover note of the
 * run's saved work (tools/resume-brief.ts), so it continues rather than
 * starting over.
 */
export async function resumeRun(runId: string): Promise<RunActionResult> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { error: "Not signed in." };

  const run = await requireOwnedRun(supabase, runId, userId);
  if (!run) return { error: "Run not found." };

  const actions = await actionStateFor(supabase, run);
  if (actions.resume.kind !== "enabled") {
    return { error: actions.resume.kind === "disabled" ? actions.resume.reason : "This run cannot be resumed." };
  }

  // replay_mode too: runs created before migration 019 all carry the column default, which may not match this server's mode.
  await updateRun(supabase, runId, { status: "queued", queued_at: new Date().toISOString(), failure_reason: null, pause_requested_at: null, replay_mode: isReplayMode() });
  return {};
}

export interface RerunResult {
  runId?: string;
  error?: string;
}

/**
 * Terminal runs are never mutated (§17.5) - re-running always creates a
 * new run seeded from the old one's objective/runner/model/scraper, so
 * the original stays intact as history. A `partial` re-run is seeded
 * with a higher candidate limit, per the action matrix's own note
 * ("seeded with higher limits") - a partial result most often means the
 * candidate pool ran out before reaching the target, not that the ICP
 * was wrong.
 */
export async function rerunRun(runId: string): Promise<RerunResult> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { error: "Not signed in." };

  const run = await requireOwnedRun(supabase, runId, userId);
  if (!run) return { error: "Run not found." };

  const actions = await actionStateFor(supabase, run);
  if (actions.rerun.kind !== "enabled") {
    return { error: actions.rerun.kind === "disabled" ? actions.rerun.reason : "This run cannot be re-run." };
  }

  const seedLimits: Partial<RunLimits> =
    run.status === "partial" ? { ...run.limits, candidate_limit: (run.limits.candidate_limit ?? 25) + 10 } : run.limits;

  const newRun = await insertRun(supabase, {
    user_id: userId,
    objective_raw: run.objective_raw,
    status: "queued",
    ...(isProduction() ? productionRunConfig() : { runner: run.runner ?? undefined, model: run.model ?? undefined, scraper: run.scraper ?? undefined }),
    replay_mode: isReplayMode(),
    limits: clampLimits(seedLimits),
    queued_at: new Date().toISOString(),
  });

  return { runId: newRun.id };
}

/** §17.5: answering a clarification is the one action enabled only in `awaiting_input`; it requeues the same run for the worker to pick back up with the answer attached. */
export async function answerClarification(runId: string, answer: string): Promise<RunActionResult> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { error: "Not signed in." };

  const run = await requireOwnedRun(supabase, runId, userId);
  if (!run) return { error: "Run not found." };

  const actions = await actionStateFor(supabase, run);
  if (actions.answerClarification.kind !== "enabled") {
    return {
      error: actions.answerClarification.kind === "disabled" ? actions.answerClarification.reason : "This run isn't waiting on an answer.",
    };
  }

  const trimmed = answer.trim();
  if (!trimmed) {
    return { error: "Please provide an answer before resuming." };
  }

  await updateRun(supabase, runId, {
    clarification_answer: trimmed,
    status: "queued",
    queued_at: new Date().toISOString(),
  });
  return {};
}
