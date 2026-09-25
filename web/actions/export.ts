"use server";

import { createClient } from "@/lib/supabase/server";
import { getRunById } from "@core/db/runs";
import { listLeadsForRun } from "@core/db/leads";
import { listDraftsForLead } from "@core/db/drafts";
import { buildSamplePack, samplePackToMarkdown, samplePackToText, type SamplePack } from "@core/quality/sample-pack";
import type { OutreachDraftRow } from "@core/db/row-types";

export interface SamplePackResult {
  pack?: SamplePack;
  markdown?: string;
  text?: string;
  error?: string;
}

export async function getSamplePack(runId: string): Promise<SamplePackResult> {
  const supabase = await createClient();
  const run = await getRunById(supabase, runId);
  if (!run) return { error: "Run not found." };

  const leads = await listLeadsForRun(supabase, runId);
  const qualified = leads.filter((l) => l.qualification_status === "qualified");
  const draftsByLeadId = new Map<string, OutreachDraftRow[]>(
    await Promise.all(qualified.map(async (l) => [l.id, await listDraftsForLead(supabase, l.id)] as const)),
  );

  const pack = buildSamplePack({ objective: run.objective_raw, qualifiedLeads: qualified, draftsByLeadId });
  return { pack, markdown: samplePackToMarkdown(pack), text: samplePackToText(pack) };
}
