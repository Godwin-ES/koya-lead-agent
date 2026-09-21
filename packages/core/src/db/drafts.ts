import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewOutreachDraft, OutreachDraftRow } from "./row-types.js";

/**
 * Thin `outreach_drafts` wrappers. The `outreach_requires_qualified`
 * trigger (Task 4) is what actually enforces "only for qualified leads" -
 * this module doesn't duplicate that check, it just surfaces whatever
 * error the database raises.
 */

export async function upsertOutreachDraft(supabase: SupabaseClient, values: NewOutreachDraft): Promise<OutreachDraftRow> {
  const { data, error } = await supabase
    .from("outreach_drafts")
    .upsert(values, { onConflict: "lead_id,channel,step" })
    .select()
    .single();
  if (error) throw error;
  return data as OutreachDraftRow;
}

export async function listDraftsForLead(supabase: SupabaseClient, leadId: string): Promise<OutreachDraftRow[]> {
  const { data, error } = await supabase
    .from("outreach_drafts")
    .select()
    .eq("lead_id", leadId)
    .order("channel", { ascending: true })
    .order("step", { ascending: true });
  if (error) throw error;
  return (data ?? []) as OutreachDraftRow[];
}
