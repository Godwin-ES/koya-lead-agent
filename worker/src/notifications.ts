import type { SupabaseClient } from "@supabase/supabase-js";
import { getRunById, getRunSummary } from "@core/db/runs";
import { sumCostForRun } from "@core/db/cost";
import { awaitingInputMessage, runCompletedMessage, runFailedMessage, runStoppedShortMessage, sendDiscord, type RunOutcome } from "@core/notify/discord";
import type { FailureKind, FailureProvider } from "@core/domain/failure";

/**
 * The worker's notifications: one message when a live run reaches a point
 * someone should know about. Replay (test) runs never notify. Every call
 * swallows its own errors - a notification must never fail a run.
 */
export async function notifyRunOutcome(supabase: SupabaseClient, runId: string): Promise<void> {
  try {
    const run = await getRunById(supabase, runId);
    if (!run || run.replay_mode) return;

    if (run.status === "awaiting_input" && run.clarification_question) {
      await sendDiscord("runs", awaitingInputMessage(run.id, run.objective_raw, run.clarification_question));
      return;
    }
    if (run.status !== "completed" && run.status !== "partial") return;

    const [summary, costUsd] = await Promise.all([getRunSummary(supabase, run.id), sumCostForRun(supabase, run.id)]);
    const outcome: RunOutcome = {
      runId: run.id,
      objective: run.objective_raw,
      qualified: summary.qualified_count,
      needsReview: summary.needs_review_count,
      target: run.limits.target_qualified ?? summary.qualified_count,
      costUsd,
      durationMs: run.started_at && run.finished_at ? new Date(run.finished_at).getTime() - new Date(run.started_at).getTime() : null,
    };
    await sendDiscord("runs", run.status === "completed" ? runCompletedMessage(outcome) : runStoppedShortMessage(outcome, run.stop_details ?? null));
  } catch (err) {
    console.error(`run ${runId}: couldn't send its notification:`, err);
  }
}

export async function notifyRunFailure(
  supabase: SupabaseClient,
  runId: string,
  failure: { kind: FailureKind; provider: FailureProvider | null; message: string; resumeInMs: number | null },
): Promise<void> {
  try {
    const run = await getRunById(supabase, runId);
    if (!run || run.replay_mode) return;
    await sendDiscord("alerts", runFailedMessage({ runId, objective: run.objective_raw, ...failure }));
  } catch (err) {
    console.error(`run ${runId}: couldn't send its failure alert:`, err);
  }
}
