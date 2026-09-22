"use server";

import { createClient } from "@/lib/supabase/server";
import { insertRun, listRunsForUser, getRunById, updateRun } from "@core/db/runs";
import { listLeadsForRun } from "@core/db/leads";
import { validateObjective } from "@core/validation/objective";
import { clampLimits } from "@core/domain/limits";
import { deriveRunActions } from "@core/domain/run-actions";
import type { RunLimits, RunCounters, Runner, Scraper } from "@core/domain/types";
import type { RunRow } from "@core/db/row-types";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CreateRunInput {
  objectiveText: string;
  limits: Partial<RunLimits>;
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
 * §7.1), refuses a confidently unsafe objective server-side, persists
 * the verdict and any dismissal onto the run itself, copies every limit
 * onto the row (clamped, so the agent can never receive an out-of-range
 * request), and is idempotent on the client-generated key.
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

  const limits = clampLimits(input.limits);

  const run = await insertRun(supabase, {
    user_id: user.id,
    objective_raw: input.objectiveText,
    status: "queued",
    runner: input.runner,
    model: input.model,
    scraper: input.scraper,
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

export async function listMyRuns() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  return listRunsForUser(supabase, user.id);
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
  });
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

/** Requeues the same run row - only ever offered for `failed` (§17.5), never for a terminal success state, which uses rerun instead. */
export async function retryRun(runId: string): Promise<RunActionResult> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { error: "Not signed in." };

  const run = await requireOwnedRun(supabase, runId, userId);
  if (!run) return { error: "Run not found." };

  const actions = await actionStateFor(supabase, run);
  if (actions.retry.kind !== "enabled") {
    return { error: actions.retry.kind === "disabled" ? actions.retry.reason : "This run cannot be retried." };
  }

  await updateRun(supabase, runId, { status: "queued", queued_at: new Date().toISOString(), failure_reason: null });
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
    runner: run.runner ?? undefined,
    model: run.model ?? undefined,
    scraper: run.scraper ?? undefined,
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
