import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftRequestRow } from "./row-types";

/** `claim_next_draft_request(worker_id, replay_mode)` - null when nothing is queued for this worker's mode. */
export async function claimNextDraftRequest(supabase: SupabaseClient, workerId: string, replayMode: boolean): Promise<DraftRequestRow | null> {
  const { data, error } = await supabase.rpc("claim_next_draft_request", { p_worker_id: workerId, p_replay_mode: replayMode }).single();
  if (error) throw error;
  const row = data as DraftRequestRow;
  return row?.id ? row : null;
}

export async function finishDraftRequest(supabase: SupabaseClient, id: string, status: "done" | "failed", error: string | null): Promise<void> {
  const { error: updateError } = await supabase.from("draft_requests").update({ status, error, finished_at: new Date().toISOString() }).eq("id", id);
  if (updateError) throw updateError;
}

/** The most recent request per lead, for the review UI's "Drafting…" state. */
export async function listLatestDraftRequests(supabase: SupabaseClient, runId: string): Promise<Map<string, DraftRequestRow>> {
  const { data, error } = await supabase.from("draft_requests").select().eq("run_id", runId).order("created_at", { ascending: false });
  if (error) throw error;
  const latest = new Map<string, DraftRequestRow>();
  for (const row of (data ?? []) as DraftRequestRow[]) if (!latest.has(row.lead_id)) latest.set(row.lead_id, row);
  return latest;
}
