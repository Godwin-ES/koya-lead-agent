import { z } from "zod";

/**
 * Saved next to the ICP by `save_icp`, never inside it - the ICP object's
 * key set is fixed by icp-refinement-guide.md. Industry *labels* are what
 * the agent supplies (it knows LinkedIn's industry names, not their
 * numeric codes); save_icp resolves them to codes against the vendored
 * LinkedIn table and rejects any label that isn't a real one.
 */
export const DiscoveryFiltersInputSchema = z
  .object({
    linkedin_industries: z.array(z.string().min(1)).min(1).max(20),
    headcount_min: z.number().int().min(1).nullable(),
    headcount_max: z.number().int().min(1).nullable(),
    locations: z.array(z.string().min(3)).min(1).max(20),
  })
  .refine((f) => f.headcount_min === null || f.headcount_max === null || f.headcount_min <= f.headcount_max, {
    message: "headcount_min must be <= headcount_max",
  });

export type DiscoveryFiltersInput = z.infer<typeof DiscoveryFiltersInputSchema>;

/** What's stored in `runs.discovery_filters` after label → code resolution. */
export interface DiscoveryFilters {
  industries: Array<{ id: string; label: string }>;
  headcount_min: number | null;
  headcount_max: number | null;
  locations: string[];
}
