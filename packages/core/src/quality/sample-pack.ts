import type { LeadRow, OutreachDraftRow } from "../db/row-types";

/**
 * The sample pack's markdown, built as a pure function so it's directly
 * unit-testable (Task 19 Step 1: "renders a sample pack containing
 * objective, sources, reasoning, and three emails per lead") without
 * Next.js's request/cookie machinery - `web/actions/export.ts` is a
 * thin `"use server"` wrapper that fetches the rows and calls this.
 * Only qualified leads are included - the sample pack is the evidence a
 * reviewer reads, not every candidate the agent ever looked at.
 */
export interface SamplePackInput {
  objective: string;
  qualifiedLeads: LeadRow[];
  draftsByLeadId: Map<string, OutreachDraftRow[]>;
  generatedAt?: string;
}

function leadSection(lead: LeadRow, drafts: OutreachDraftRow[]): string {
  const emails = drafts.filter((d) => d.channel === "email").sort((a, b) => a.step - b.step);
  const linkedin = drafts.find((d) => d.channel === "linkedin");

  const lines = [
    `## ${lead.company_name} (${lead.company_domain})`,
    "",
    `**Confidence:** ${Math.round(lead.confidence * 100)}%`,
    "",
    `**Fit reasons:** ${lead.fit_reasons.join("; ") || "None recorded."}`,
    `**Concerns:** ${lead.concerns.join("; ") || "None recorded."}`,
    "",
    "**Source URLs:**",
    ...lead.source_urls.map((url) => `- ${url}`),
    "",
    "**Source summary:**",
    lead.source_summary || "No summary recorded.",
    "",
  ];

  for (const draft of emails) {
    lines.push(`### Email ${draft.step}${draft.subject ? `: ${draft.subject}` : ""}`, "", draft.body, "", `_${draft.personalization_note}_`, "");
  }
  if (linkedin) {
    lines.push("### LinkedIn message", "", linkedin.body, "", `_${linkedin.personalization_note}_`, "");
  }

  return lines.join("\n");
}

export function buildSamplePackMarkdown(input: SamplePackInput): string {
  const header = [
    "# Lead sample pack",
    "",
    `**Objective:** ${input.objective}`,
    `**Qualified leads:** ${input.qualifiedLeads.length}`,
    `**Generated:** ${input.generatedAt ?? new Date().toISOString()}`,
    "",
    "---",
    "",
  ];

  const body = input.qualifiedLeads.map((lead) => leadSection(lead, input.draftsByLeadId.get(lead.id) ?? []));

  return [...header, ...body].join("\n");
}
