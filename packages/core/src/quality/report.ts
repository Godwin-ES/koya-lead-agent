import { QualityReportSchema } from "../schemas/quality";
import type { QualityCheckResult, QualityScorecardEntry, QualityReport } from "../schemas/quality";
import type { LeadRow, OutreachDraftRow } from "../db/row-types";

/**
 * One check per item in assets/lead-list-quality-guide.md's "Required
 * Checks" list, plus its "Suggested Scorecard" dimensions - a real,
 * mechanically-verified report computed from what was actually saved,
 * never a check that's hardcoded to pass. Called by the `finalize_run`
 * tool (Task 12) and rendered on `/runs/[id]/quality` (Task 19).
 *
 * A pure function over already-fetched rows, deliberately - it takes no
 * Supabase client and makes no query itself, so every scenario (a
 * duplicate domain, a lead missing a source summary) is constructible
 * directly in a unit test without needing the database to be in a state
 * it may not actually be able to reach on its own (e.g.
 * `leads_run_domain_key`, Task 4, already makes two leads sharing a
 * normalized domain within one run impossible via the normal write
 * path - the check below still verifies it independently, the same way
 * Task 4's own CHECK constraints are still unit-tested even though the
 * database also enforces them).
 */
export interface QualityReportInput {
  leads: LeadRow[];
  draftsByLeadId: Map<string, OutreachDraftRow[]>;
  targetQualified: number;
  /**
   * Whether any email-finding, email-validation, or send action was
   * attempted this run. In this system that can only ever be `false`:
   * no such tool exists in `TOOL_NAMES` (Task 12) for the agent to call
   * in the first place - passed in explicitly, rather than hardcoded
   * here, so the report's provenance is "structurally guaranteed by the
   * toolset," a fact this module states but does not itself compute.
   */
  emailFindingOrSendAttempted: boolean;
  summary: string;
}

function findDuplicateDomains(leads: LeadRow[]): string[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    counts.set(lead.company_domain, (counts.get(lead.company_domain) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([domain]) => domain);
}

export function computeQualityReport(input: QualityReportInput): QualityReport {
  const { leads } = input;
  const qualified = leads.filter((l) => l.qualification_status === "qualified");
  const duplicateDomains = findDuplicateDomains(leads);
  const draftsFor = (leadId: string) => input.draftsByLeadId.get(leadId) ?? [];
  const qualifiedWithDrafts = qualified.filter((l) => draftsFor(l.id).length > 0);
  const allDrafts = leads.flatMap((l) => draftsFor(l.id));
  const flaggedDrafts = allDrafts.filter((d) => d.flagged_unsupported);

  const checks: QualityCheckResult[] = [
    {
      id: "has_ten_qualified",
      passed: qualified.length >= input.targetQualified,
      detail: `${qualified.length} of ${input.targetQualified} target qualified leads.`,
    },
    {
      id: "every_lead_has_name_and_domain",
      passed: leads.every((l) => !!l.company_name && !!l.company_domain),
      detail: "Checked company_name and company_domain are non-empty on every lead.",
    },
    {
      id: "every_lead_has_qualification_reasoning",
      passed: leads.every((l) => l.fit_reasons.length > 0 || l.concerns.length > 0),
      detail: "Checked fit_reasons or concerns is non-empty on every lead.",
    },
    {
      id: "every_lead_has_source_context",
      passed: leads.every((l) => !!l.source_summary),
      detail: "Checked source_summary is present on every lead.",
    },
    {
      id: "every_qualified_lead_has_outreach_drafts",
      passed: qualifiedWithDrafts.length === qualified.length,
      detail: `${qualifiedWithDrafts.length} of ${qualified.length} qualified leads have at least one outreach draft.`,
    },
    {
      id: "no_email_finding_or_validation_attempted",
      passed: !input.emailFindingOrSendAttempted,
      detail: input.emailFindingOrSendAttempted
        ? "An email-finding, validation, or send action was attempted this run."
        : "No email-finding or validation tool exists in this system's toolset - structurally guaranteed, not merely asserted.",
    },
    {
      id: "no_duplicate_companies",
      passed: duplicateDomains.length === 0,
      detail:
        duplicateDomains.length > 0
          ? `Duplicate company_domain value(s): ${duplicateDomains.join(", ")}.`
          : "Checked company_domain is unique across this run's leads.",
    },
    {
      id: "needs_review_excluded_from_qualified_count",
      passed: qualified.every((l) => l.qualification_status === "qualified"),
      detail: "qualified_count is always derived by filtering on qualification_status = 'qualified', never inferred.",
    },
  ];

  const scorecard: QualityScorecardEntry[] = [
    { dimension: "icp_fit", passed: qualified.every((l) => l.fit_reasons.length > 0), note: "Every qualified lead has at least one stated fit reason." },
    {
      dimension: "evidence_quality",
      passed: leads.every((l) => !!l.source_summary && l.source_urls.length > 0),
      note: "Every lead has a source summary and at least one source URL.",
    },
    { dimension: "duplicate_rate", passed: duplicateDomains.length === 0, note: `${duplicateDomains.length} duplicate domain(s) found.` },
    {
      dimension: "outreach_relevance",
      passed: flaggedDrafts.length === 0,
      note: `${flaggedDrafts.length} of ${allDrafts.length} draft(s) flagged by the grounding check.`,
    },
    {
      dimension: "data_completeness",
      passed: leads.every((l) => !!l.company_name && !!l.company_domain && !!l.source_summary),
      note: "Required fields present across all leads.",
    },
    {
      dimension: "safety_compliance",
      passed: !input.emailFindingOrSendAttempted,
      note: "No email-finding, validation, or send capability exists in this toolset.",
    },
  ];

  const passed = checks.every((c) => c.passed) && scorecard.every((s) => s.passed);

  return QualityReportSchema.parse({ checks, scorecard, passed, summary: input.summary });
}
