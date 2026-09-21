import { z } from "zod";

/**
 * The exact ICP object shape from
 * aat-c3-week-5-lead-agent/assets/icp-refinement-guide.md's "Output
 * Format" section. Key set is enforced byte-for-byte against the guide in
 * tests/contract/schemas-match-guides.test.ts - do not add, rename, or
 * remove a field here without also updating the guide (or, more likely,
 * without realizing the guide is the one that should not move).
 */
export const IcpSchema = z.object({
  target_company_type: z.string().min(1),
  industries: z.array(z.string().min(1)),
  geography: z.array(z.string().min(1)),
  headcount_range: z.string().min(1),
  buyer_persona: z.string().min(1),
  business_problem: z.string().min(1),
  hard_filters: z.array(z.string().min(1)),
  soft_preferences: z.array(z.string().min(1)),
  disqualifiers: z.array(z.string().min(1)),
});

export type Icp = z.infer<typeof IcpSchema>;
