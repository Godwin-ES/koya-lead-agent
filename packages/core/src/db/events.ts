import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentEventRow } from "./row-types";

/** Wraps `append_agent_event(...)` - powers the live run timeline (§17.7). */

export async function appendAgentEvent(
  supabase: SupabaseClient,
  runId: string,
  type: AgentEventRow["type"],
  payload?: Record<string, unknown>,
): Promise<AgentEventRow> {
  const { data, error } = await supabase
    .rpc("append_agent_event", { p_run_id: runId, p_type: type, p_payload: payload ?? null })
    .single();
  if (error) throw error;
  return data as AgentEventRow;
}

export async function listAgentEventsForRun(supabase: SupabaseClient, runId: string): Promise<AgentEventRow[]> {
  const { data, error } = await supabase
    .from("agent_events")
    .select()
    .eq("run_id", runId)
    .order("seq", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AgentEventRow[];
}
