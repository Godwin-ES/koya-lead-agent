import type { LeadRow, OutreachDraftRow } from "../db/row-types";

/**
 * The sample pack: the evidence and drafts a reviewer reads for each
 * qualified lead. Built once as structured data, which the web page
 * renders as a formatted document (on screen and in print), and from which
 * the markdown download and the plain-text "Copy all" are produced. Pure,
 * so it's unit-testable without Next.js's request machinery.
 */
export interface SamplePackInput {
  objective: string;
  qualifiedLeads: LeadRow[];
  draftsByLeadId: Map<string, OutreachDraftRow[]>;
  generatedAt?: string;
}

export interface SamplePackEmail {
  step: number;
  subject: string;
  body: string;
  flagged: boolean;
  approved: boolean;
}

export interface SamplePackLead {
  id: string;
  companyName: string;
  companyDomain: string;
  confidence: number;
  fitReasons: string[];
  concerns: string[];
  sourceUrls: string[];
  sourceSummary: string;
  emails: SamplePackEmail[];
  linkedin: { body: string; flagged: boolean; approved: boolean } | null;
  /** Set when a reviewer, not the agent, qualified the lead. */
  reviewerReason: string | null;
}

export interface SamplePack {
  objective: string;
  generatedAt: string;
  leads: SamplePackLead[];
}

export function buildSamplePack(input: SamplePackInput): SamplePack {
  return {
    objective: input.objective,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    leads: input.qualifiedLeads.map((lead) => {
      const drafts = input.draftsByLeadId.get(lead.id) ?? [];
      const linkedin = drafts.find((d) => d.channel === "linkedin");
      return {
        id: lead.id,
        companyName: lead.company_name,
        companyDomain: lead.company_domain,
        confidence: lead.confidence,
        fitReasons: lead.fit_reasons,
        concerns: lead.concerns,
        sourceUrls: lead.source_urls,
        sourceSummary: lead.source_summary ?? "",
        emails: drafts
          .filter((d) => d.channel === "email")
          .sort((a, b) => a.step - b.step)
          .map((d) => ({ step: d.step, subject: d.subject ?? "", body: d.body, flagged: d.flagged_unsupported, approved: d.approved_at !== null && d.approved_at !== undefined })),
        linkedin: linkedin ? { body: linkedin.body, flagged: linkedin.flagged_unsupported, approved: linkedin.approved_at !== null && linkedin.approved_at !== undefined } : null,
        reviewerReason: lead.decided_by === "reviewer" ? lead.review_reason : null,
      };
    }),
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

export function samplePackToMarkdown(pack: SamplePack): string {
  const lines = [
    "# Lead sample pack",
    "",
    `**Objective:** ${pack.objective}  `,
    `**Qualified leads:** ${pack.leads.length}  `,
    `**Generated:** ${formatDate(pack.generatedAt)}`,
    "",
  ];

  for (const lead of pack.leads) {
    lines.push("---", "", `## ${lead.companyName} (${lead.companyDomain})`, "", `**Confidence:** ${Math.round(lead.confidence * 100)}%`, "");
    if (lead.reviewerReason) lines.push(`**Qualified by reviewer:** ${lead.reviewerReason}`, "");
    lines.push("**Why it qualifies**", "", ...(lead.fitReasons.length ? lead.fitReasons.map((r) => `- ${r}`) : ["- None recorded."]), "");
    if (lead.concerns.length) lines.push("**Concerns**", "", ...lead.concerns.map((c) => `- ${c}`), "");
    lines.push("**Source summary**", "", lead.sourceSummary || "No summary recorded.", "");
    lines.push("**Sources**", "", ...lead.sourceUrls.map((u) => `- ${u}`), "");
    for (const email of lead.emails) {
      lines.push(`### Email ${email.step}${email.approved ? " (approved)" : ""}`, "", `**Subject:** ${email.subject}`, "", email.body, "");
    }
    if (lead.linkedin) lines.push(`### LinkedIn message${lead.linkedin.approved ? " (approved)" : ""}`, "", lead.linkedin.body, "");
  }

  return lines.join("\n");
}

/** What "Copy all" puts on the clipboard: readable anywhere it's pasted, no markdown syntax. */
export function samplePackToText(pack: SamplePack): string {
  const lines = ["LEAD SAMPLE PACK", "", `Objective: ${pack.objective}`, `Qualified leads: ${pack.leads.length}`, `Generated: ${formatDate(pack.generatedAt)}`, ""];

  for (const lead of pack.leads) {
    lines.push("=".repeat(60), `${lead.companyName} (${lead.companyDomain}) - ${Math.round(lead.confidence * 100)}% confidence`, "");
    if (lead.reviewerReason) lines.push(`Qualified by reviewer: ${lead.reviewerReason}`, "");
    lines.push("Why it qualifies:", ...(lead.fitReasons.length ? lead.fitReasons.map((r) => `  - ${r}`) : ["  - None recorded."]), "");
    if (lead.concerns.length) lines.push("Concerns:", ...lead.concerns.map((c) => `  - ${c}`), "");
    lines.push("Source summary:", lead.sourceSummary || "No summary recorded.", "", "Sources:", ...lead.sourceUrls.map((u) => `  - ${u}`), "");
    for (const email of lead.emails) {
      lines.push(`--- Email ${email.step}${email.approved ? " (approved)" : ""} ---`, `Subject: ${email.subject}`, "", email.body, "");
    }
    if (lead.linkedin) lines.push(`--- LinkedIn message${lead.linkedin.approved ? " (approved)" : ""} ---`, lead.linkedin.body, "");
  }

  return lines.join("\n");
}
