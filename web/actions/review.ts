"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLeadById } from "@core/db/leads";
import { checkEditedDraft, SENDER_COMPANY } from "@core/domain/outreach";
import { errorMessage } from "@core/domain/errors";
import { groundDraft } from "@core/tools/draft-grounding";
import { isReplayMode } from "@core/providers/replay/recorder";
import type { LeadQualificationStatus } from "@core/domain/types";
import type { OutreachDraftRow } from "@core/db/row-types";

export interface ReviewResult {
  error?: string;
  /** Advisory notes on an edit - saved regardless. */
  warnings?: string[];
  /** The edit's sentences that couldn't be traced to the company's sources. */
  unsupportedClaims?: string[];
}

function revalidateRun(runId: string) {
  revalidatePath(`/runs/${runId}`, "layout");
}

/**
 * A reviewer's decision on a lead. Qualifying can also queue the worker to
 * draft its outreach in the same step ("Qualify & draft outreach").
 */
export async function reviewLead(leadId: string, status: LeadQualificationStatus, reason: string, draftOutreach = false): Promise<ReviewResult> {
  const supabase = await createClient();
  const { data: lead, error } = await supabase.rpc("review_lead", { p_lead_id: leadId, p_status: status, p_reason: reason }).single();
  if (error) return { error: errorMessage(error) };

  const runId = (lead as { run_id: string }).run_id;
  if (status === "qualified" && draftOutreach) {
    const { error: requestError } = await supabase.rpc("request_drafts", { p_lead_id: leadId, p_replay_mode: isReplayMode() }).single();
    if (requestError) return { error: `Qualified, but drafting couldn't be queued: ${errorMessage(requestError)}` };
  }
  revalidateRun(runId);
  return {};
}

export async function requestDrafts(leadId: string): Promise<ReviewResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_drafts", { p_lead_id: leadId, p_replay_mode: isReplayMode() }).single();
  if (error) return { error: errorMessage(error) };
  revalidateRun((data as { run_id: string }).run_id);
  return {};
}

async function loadOwnDraft(draftId: string) {
  const supabase = await createClient();
  const { data: draft, error } = await supabase.from("outreach_drafts").select().eq("id", draftId).maybeSingle();
  if (error || !draft) return { supabase, error: "Draft not found." } as const;
  const lead = await getLeadById(supabase, (draft as OutreachDraftRow).lead_id);
  if (!lead) return { supabase, error: "Lead not found." } as const;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const senderName = typeof user?.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "";
  return { supabase, draft: draft as OutreachDraftRow, lead, senderName } as const;
}

/** Saves a reviewer's edit. The agent's version is kept, so it can be restored. Editing clears approval. */
export async function editDraft(draftId: string, subject: string | null, body: string): Promise<ReviewResult> {
  const loaded = await loadOwnDraft(draftId);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, draft, lead, senderName } = loaded;

  const cleanSubject = draft.channel === "email" ? (subject ?? "").trim() : null;
  const { blocking, warnings } = checkEditedDraft({ channel: draft.channel, subject: cleanSubject, body });
  if (blocking.length) return { error: blocking.join(" ") };

  const grounding = await groundDraft(supabase, lead, body, senderName ? [senderName] : []);
  const { error } = await supabase
    .rpc("edit_draft", {
      p_draft_id: draftId,
      p_subject: cleanSubject,
      p_body: body.trim(),
      p_grounding: { flagged: grounding.flagged, unsupportedClaims: grounding.unsupportedClaims },
      p_flagged: grounding.flagged,
    })
    .single();
  if (error) return { error: errorMessage(error) };

  revalidateRun(lead.run_id);
  return { warnings, unsupportedClaims: grounding.unsupportedClaims };
}

export async function revertDraft(draftId: string): Promise<ReviewResult> {
  const loaded = await loadOwnDraft(draftId);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, draft, lead } = loaded;
  if (!draft.edited_at) return {};

  const grounding = await groundDraft(supabase, lead, draft.original_body ?? "", [SENDER_COMPANY]);
  const { error } = await supabase
    .rpc("revert_draft", { p_draft_id: draftId, p_grounding: { flagged: grounding.flagged, unsupportedClaims: grounding.unsupportedClaims }, p_flagged: grounding.flagged })
    .single();
  if (error) return { error: errorMessage(error) };
  revalidateRun(lead.run_id);
  return {};
}

export async function setDraftApproval(draftId: string, approved: boolean): Promise<ReviewResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_draft_approval", { p_draft_id: draftId, p_approved: approved }).single();
  if (error) return { error: errorMessage(error) };
  const lead = await getLeadById(supabase, (data as OutreachDraftRow).lead_id);
  if (lead) revalidateRun(lead.run_id);
  return {};
}
