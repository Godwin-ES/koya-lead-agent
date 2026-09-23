import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewRun, RunRow, RunSummary } from "./row-types";

/**
 * Thin wrappers around the `runs` table and its RPCs. No business logic -
 * callers (server actions in `web/actions/`, the worker's orchestrator)
 * decide what to do with these results. Takes a `SupabaseClient` rather
 * than owning one, so the same functions work with the user's own
 * anon-key session (web) or `service_role` (worker) - RLS (or its
 * absence, for service_role) decides what each caller can actually reach.
 */

export async function insertRun(supabase: SupabaseClient, values: NewRun): Promise<RunRow> {
  const { data, error } = await supabase.from("runs").insert(values).select().single();
  if (error) throw error;
  return data as RunRow;
}

export async function getRunById(supabase: SupabaseClient, id: string): Promise<RunRow | null> {
  const { data, error } = await supabase.from("runs").select().eq("id", id).maybeSingle();
  if (error) throw error;
  return data as RunRow | null;
}

export async function listRunsForUser(supabase: SupabaseClient, userId: string): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from("runs")
    .select()
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RunRow[];
}

export async function updateRun(supabase: SupabaseClient, id: string, patch: Partial<RunRow>): Promise<RunRow> {
  const { data, error } = await supabase.from("runs").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data as RunRow;
}

/**
 * `merge_run_counters(run_id, patch)` - the only correct way to update
 * one or more `counters` fields. `updateRun({ counters: {...} })` does a
 * plain column REPLACE, not a merge - a real bug (found live) came from
 * exactly that: one caller's write, built from a local snapshot that
 * didn't know about a field a different call had just written, silently
 * erased it. This RPC merges at the database level (`counters || patch`),
 * so no caller's local staleness can ever clobber a field it isn't
 * itself touching.
 */
export async function mergeRunCounters(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, number>,
): Promise<RunRow> {
  const { data, error } = await supabase.rpc("merge_run_counters", { p_run_id: id, p_patch: patch }).single();
  if (error) throw error;
  return data as RunRow;
}

/** `claim_next_run(worker_id)` - returns null when nothing is queued. */
export async function claimNextRun(supabase: SupabaseClient, workerId: string): Promise<RunRow | null> {
  const { data, error } = await supabase.rpc("claim_next_run", { p_worker_id: workerId }).single();
  if (error) throw error;
  const row = data as RunRow;
  return row?.id ? row : null;
}

/** `heartbeat(run_id, worker_id)` - false means this worker no longer owns the run. */
export async function heartbeat(supabase: SupabaseClient, runId: string, workerId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("heartbeat", { p_run_id: runId, p_worker_id: workerId });
  if (error) throw error;
  return data as boolean;
}

/** `reclaim_stale_runs()` - returns the ids of every run it requeued or failed. */
export async function reclaimStaleRuns(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.rpc("reclaim_stale_runs");
  if (error) throw error;
  return (data ?? []) as string[];
}

/** `finalize_run(...)` - persists the quality report and transitions to completed/partial. */
export async function finalizeRun(
  supabase: SupabaseClient,
  args: { runId: string; checks: unknown; scorecard: unknown; passed: boolean; summary: string },
): Promise<RunRow> {
  const { data, error } = await supabase
    .rpc("finalize_run", {
      p_run_id: args.runId,
      p_checks: args.checks,
      p_scorecard: args.scorecard,
      p_passed: args.passed,
      p_summary: args.summary,
    })
    .single();
  if (error) throw error;
  return data as RunRow;
}

/** `run_summary(run_id)` - live counts, cheap enough for the agent to check its own progress. */
export async function getRunSummary(supabase: SupabaseClient, runId: string): Promise<RunSummary> {
  const { data, error } = await supabase.rpc("run_summary", { p_run_id: runId });
  if (error) throw error;
  return data as RunSummary;
}
