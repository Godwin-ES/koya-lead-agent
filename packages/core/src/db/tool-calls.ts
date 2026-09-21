import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolCallRow } from "./row-types.js";

/**
 * Wraps `record_tool_call(...)` - the only writer to `tool_calls`. `seq`
 * is allocated server-side by the RPC (an advisory-lock-protected
 * per-run counter, Task 5), never computed client-side, so this stays
 * correct under the concurrent tool calls parallel tool use produces.
 */

export interface RecordToolCallInput {
  runId: string;
  toolName: string;
  status: "ok" | "error" | "denied" | "cache_hit";
  purpose?: string;
  inputSummary?: string;
  resultSummary?: string;
  errorMessage?: string;
  denialReason?: string;
  durationMs?: number;
  estimatedCostUsd?: number;
}

export async function recordToolCall(supabase: SupabaseClient, input: RecordToolCallInput): Promise<ToolCallRow> {
  const { data, error } = await supabase
    .rpc("record_tool_call", {
      p_run_id: input.runId,
      p_tool_name: input.toolName,
      p_status: input.status,
      purpose: input.purpose ?? null,
      input_summary: input.inputSummary ?? null,
      result_summary: input.resultSummary ?? null,
      error_message: input.errorMessage ?? null,
      denial_reason: input.denialReason ?? null,
      duration_ms: input.durationMs ?? null,
      estimated_cost_usd: input.estimatedCostUsd ?? null,
    })
    .single();
  if (error) throw error;
  return data as ToolCallRow;
}

export async function listToolCallsForRun(supabase: SupabaseClient, runId: string): Promise<ToolCallRow[]> {
  const { data, error } = await supabase
    .from("tool_calls")
    .select()
    .eq("run_id", runId)
    .order("seq", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ToolCallRow[];
}
