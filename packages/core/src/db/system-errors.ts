import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `system_errors` - SYSTEM-DESIGN-NEXTJS.md §13: "Every failure writes a
 * system_errors row with run id, phase, tool, provider, message and
 * stack. The UI shows the error inline on the run, not only in a log
 * the grader will never open." Worker-only write (service_role) - the
 * web app never inserts here.
 */
export interface RecordSystemErrorInput {
  runId?: string | null;
  phase?: string;
  toolName?: string;
  provider?: string;
  message: string;
  detail?: Record<string, unknown>;
}

export async function recordSystemError(supabase: SupabaseClient, input: RecordSystemErrorInput): Promise<void> {
  const { error } = await supabase.from("system_errors").insert({
    run_id: input.runId ?? null,
    phase: input.phase ?? null,
    tool_name: input.toolName ?? null,
    provider: input.provider ?? null,
    message: input.message,
    detail: input.detail ?? null,
  });
  if (error) throw error;
}

export interface SystemErrorRow {
  id: string;
  run_id: string | null;
  phase: string | null;
  tool_name: string | null;
  provider: string | null;
  message: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export async function listSystemErrorsForRun(supabase: SupabaseClient, runId: string): Promise<SystemErrorRow[]> {
  const { data, error } = await supabase.from("system_errors").select().eq("run_id", runId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SystemErrorRow[];
}
