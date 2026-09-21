import { z } from "zod";

/**
 * The exact qualification decision shape from
 * aat-c3-week-5-lead-agent/assets/lead-qualification-guide.md's "Output
 * Format" section. Key set is enforced byte-for-byte against the guide in
 * tests/contract/schemas-match-guides.test.ts.
 *
 * `confidence` is bounded [0, 1], matching the same constraint the
 * database enforces via CHECK (SYSTEM-DESIGN-NEXTJS.md §16 "Key
 * constraints that encode business rules") - the schema and the database
 * agree rather than one being stricter than the other.
 *
 * The guide's `qualified_status` rule that a `qualified` verdict requires
 * real evidence ("If a company is missing core evidence, mark it
 * needs_review") is enforced at the database boundary (a CHECK constraint
 * on source_urls/fit_reasons), not duplicated here as a schema-level
 * refinement - Task 4 is where that rule actually lives.
 */
export const QualificationSchema = z.object({
  company_name: z.string().min(1),
  company_domain: z.string().min(1),
  qualification_status: z.enum(["qualified", "not_qualified", "needs_review"]),
  confidence: z.number().min(0).max(1),
  fit_reasons: z.array(z.string().min(1)),
  concerns: z.array(z.string().min(1)),
  source_urls: z.array(z.string().url()),
  source_summary: z.string(),
});

export type Qualification = z.infer<typeof QualificationSchema>;
