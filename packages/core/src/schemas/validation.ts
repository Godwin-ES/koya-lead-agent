import { z } from "zod";

/**
 * The eight items in assets/icp-refinement-guide.md's "Minimum Criteria To
 * Clarify" list, slugged for machine use. `missing_criteria` on the
 * classifier result is constrained to this set
 * (SYSTEM-DESIGN-NEXTJS.md §7.1) so its output is directly reusable by the
 * agent's ICP-refinement step rather than free text that would need its
 * own parsing.
 */
export const MISSING_CRITERIA_KEYS = [
  "target_company_type",
  "industry_or_niche",
  "geography",
  "headcount_range",
  "buyer_persona",
  "business_problem",
  "hard_disqualifiers",
  "soft_preferences",
] as const;

export type MissingCriterion = (typeof MISSING_CRITERIA_KEYS)[number];

/**
 * The six verdicts a classifier call can itself produce
 * (SYSTEM-DESIGN-NEXTJS.md §7.2). "unavailable" is deliberately excluded
 * here - it is assigned by validateObjective's own fallback path when the
 * classifier cannot be reached at all (§13: "Validation degrades
 * permissive - it must never be the reason a user cannot start a run"),
 * never something the classifier itself would emit.
 */
export const CLASSIFIER_VERDICTS = [
  "valid",
  "vague",
  "incoherent",
  "not_a_request",
  "out_of_scope",
  "out_of_scope_unsafe",
] as const;

/**
 * The exact classifier result shape from SYSTEM-DESIGN-NEXTJS.md §7.1 ("It
 * returns:"). Key set is enforced byte-for-byte against that fenced block
 * in tests/contract/schemas-match-guides.test.ts.
 */
export const ValidationVerdictSchema = z.object({
  verdict: z.enum(CLASSIFIER_VERDICTS),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  missing_criteria: z.array(z.enum(MISSING_CRITERIA_KEYS)),
  suggested_rewrite: z.string(),
});

export type ClassifierVerdict = z.infer<typeof ValidationVerdictSchema>;

/**
 * The full set of verdicts a *run record* can carry, including the
 * "unavailable" fallback the classifier itself never produces. This is
 * what `objective_validations.verdict` and `runs.validation_verdict`
 * actually store (SYSTEM-DESIGN-NEXTJS.md §7.1, §13, §16) - a superset of
 * `CLASSIFIER_VERDICTS`.
 */
export const RUN_VALIDATION_VERDICTS = [...CLASSIFIER_VERDICTS, "unavailable"] as const;

export type RunValidationVerdict = (typeof RUN_VALIDATION_VERDICTS)[number];
