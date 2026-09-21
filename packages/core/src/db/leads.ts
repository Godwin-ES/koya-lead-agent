import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadRow, NewLead } from "./row-types.js";

/**
 * Thin `leads` table wrappers. `upsertLead` relies on `leads_run_domain_key`
 * (Task 4) to make a repeated save for the same company idempotent -
 * see SYSTEM-DESIGN-NEXTJS.md §14 ("Leads: UNIQUE (run_id,
 * company_domain)... Duplicate prevention is a constraint, not a prompt
 * instruction"). The `qualified_requires_evidence` CHECK still applies on
 * every insert or update through this path.
 */

export async function upsertLead(supabase: SupabaseClient, values: NewLead): Promise<LeadRow> {
  const { data, error } = await supabase
    .from("leads")
    .upsert(values, { onConflict: "run_id,company_domain" })
    .select()
    .single();
  if (error) throw error;
  return data as LeadRow;
}

export async function getLeadById(supabase: SupabaseClient, id: string): Promise<LeadRow | null> {
  const { data, error } = await supabase.from("leads").select().eq("id", id).maybeSingle();
  if (error) throw error;
  return data as LeadRow | null;
}

export async function listLeadsForRun(supabase: SupabaseClient, runId: string): Promise<LeadRow[]> {
  const { data, error } = await supabase
    .from("leads")
    .select()
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LeadRow[];
}
