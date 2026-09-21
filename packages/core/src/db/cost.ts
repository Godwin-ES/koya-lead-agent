import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostLedgerRow, NewCostLedgerEntry } from "./row-types.js";

/** `cost_ledger` - the budget meters' data source (§11, §17.7). */

export async function insertCostLedgerEntry(supabase: SupabaseClient, values: NewCostLedgerEntry): Promise<CostLedgerRow> {
  const { data, error } = await supabase.from("cost_ledger").insert(values).select().single();
  if (error) throw error;
  return data as CostLedgerRow;
}

export async function listCostForRun(supabase: SupabaseClient, runId: string): Promise<CostLedgerRow[]> {
  const { data, error } = await supabase
    .from("cost_ledger")
    .select()
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CostLedgerRow[];
}

export async function sumCostForRun(supabase: SupabaseClient, runId: string): Promise<number> {
  const rows = await listCostForRun(supabase, runId);
  return rows.reduce((total, row) => total + Number(row.estimated_cost_usd), 0);
}
