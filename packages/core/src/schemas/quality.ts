import { z } from "zod";

/**
 * The lead-list quality report shape. Like outreach.ts, this has no fenced
 * JSON block to contract-test against -
 * assets/lead-list-quality-guide.md states its "Required Checks" as a
 * bullet list and its "Suggested Scorecard" as a table. This schema turns
 * both into a structured, storable shape matching
 * SYSTEM-DESIGN-NEXTJS.md §16's `run_quality_reports` table
 * (`checks` jsonb, `scorecard` jsonb, `passed` bool, `summary`).
 *
 * Slugs below are a direct 1:1 mapping of the guide's own bullet list and
 * table rows - nothing invented, nothing renamed for convenience. Task 19
 * (the quality report) is what actually computes these; this file is only
 * the shape they're computed into.
 */

/** assets/lead-list-quality-guide.md's "Required Checks" list, in order. */
export const QUALITY_CHECK_IDS = [
  "has_ten_qualified",
  "every_lead_has_name_and_domain",
  "every_lead_has_qualification_reasoning",
  "every_lead_has_source_context",
  "every_qualified_lead_has_outreach_drafts",
  "no_email_finding_or_validation_attempted",
  "no_duplicate_companies",
  "needs_review_excluded_from_qualified_count",
] as const;

export type QualityCheckId = (typeof QUALITY_CHECK_IDS)[number];

/** assets/lead-list-quality-guide.md's "Suggested Scorecard" dimensions. */
export const QUALITY_SCORECARD_DIMENSIONS = [
  "icp_fit",
  "evidence_quality",
  "duplicate_rate",
  "outreach_relevance",
  "data_completeness",
  "safety_compliance",
] as const;

export type QualityScorecardDimension = (typeof QUALITY_SCORECARD_DIMENSIONS)[number];

export const QualityCheckResultSchema = z.object({
  id: z.enum(QUALITY_CHECK_IDS),
  passed: z.boolean(),
  detail: z.string(),
});

export const QualityScorecardEntrySchema = z.object({
  dimension: z.enum(QUALITY_SCORECARD_DIMENSIONS),
  passed: z.boolean(),
  note: z.string(),
});

/**
 * `passed` is the report's own pass/fail per
 * assets/lead-list-quality-guide.md's "Pass Standard" ("The submitted list
 * should include 10 qualified companies that pass the core checks
 * above.") - it is derived from `checks`, never set independently of them
 * (Task 19 enforces that derivation; this schema only shapes the result).
 */
export const QualityReportSchema = z.object({
  checks: z.array(QualityCheckResultSchema).length(QUALITY_CHECK_IDS.length),
  scorecard: z.array(QualityScorecardEntrySchema).length(QUALITY_SCORECARD_DIMENSIONS.length),
  passed: z.boolean(),
  summary: z.string().min(1),
});

export type QualityCheckResult = z.infer<typeof QualityCheckResultSchema>;
export type QualityScorecardEntry = z.infer<typeof QualityScorecardEntrySchema>;
export type QualityReport = z.infer<typeof QualityReportSchema>;
