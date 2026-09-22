import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunQualityReportRow } from "./row-types";

/** `run_quality_reports` - one row per finished run, written by `finalize_run` (Task 5/12), rendered on `/runs/[id]/quality` (Task 19). */
export async function getQualityReportForRun(supabase: SupabaseClient, runId: string): Promise<RunQualityReportRow | null> {
  const { data, error } = await supabase.from("run_quality_reports").select().eq("run_id", runId).maybeSingle();
  if (error) throw error;
  return data as RunQualityReportRow | null;
}
