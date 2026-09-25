import type { SupabaseClient } from "@supabase/supabase-js";
import { hashObjective } from "@core/domain/normalize";
import { candidatesPerDiscoverCall } from "@core/domain/discovery";
import { LIMIT_DEFAULTS } from "@core/domain/limits";
import { buildActorInput } from "@core/providers/discovery/apify";

/**
 * The hand-written Gemini fixtures (specific-objective, ...) all make the same discover_companies call ({ keyword:
 * "logistics" }, after save_icp's filters). This seeds an empty result
 * under that exact cache key for one run (the discovery cache is per run),
 * so the call is served without a live dispatch and finds nothing.
 */
export async function seedEmptyFixtureDiscovery(supabase: SupabaseClient, runId: string): Promise<void> {
  const requested = candidatesPerDiscoverCall(LIMIT_DEFAULTS.target_qualified);
  const input = buildActorInput(
    { industryIds: ["4"], keyword: "logistics", locations: ["United States"], companySize: ["1-10", "11-50", "51-200"], page: 1, requested },
    requested,
  );
  const { error } = await supabase.from("discovery_cache").upsert(
    {
      cache_key: `apify:${runId}:${hashObjective(JSON.stringify(input))}`,
      actor_id: "harvestapi/linkedin-company-search",
      input_json: input,
      results: { candidates: [], totalResultCount: 0 },
      item_count: 0,
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    },
    { onConflict: "cache_key" },
  );
  if (error) throw error;
}

/**
 * Counters for a fixture scenario whose single search is the run's last
 * attempt: with nothing kept and no attempts left, finalize_run is
 * legitimately allowed (see tools/finish-check.ts).
 */
export const LAST_ATTEMPT_COUNTERS = { discover_calls_used: 2 };
