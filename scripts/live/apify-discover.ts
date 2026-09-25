#!/usr/bin/env -S npx tsx
/**
 * A deliberate, capped (2-result) live run against the real discovery
 * actor, used to confirm its output shape against normalizeHarvestItem()
 * and to check real per-run cost. Worst case: $0.001 run start + 2 x
 * $0.004 = $0.009.
 *
 * Never called by `pnpm check`, `pnpm test`, or any CI path - only by a
 * human running `pnpm test:live:apify-discover` after approving the spend.
 * Requires REPLAY_MODE=false on this process only.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.REPLAY_MODE = "false";

const { discover, ACTOR_ID } = await import("../../packages/core/src/providers/discovery/apify");

console.log(`Dispatching a real, capped (2-result) run against ${ACTOR_ID}...`);
console.log("This spends real money against the shared Apify budget.");

const result = await discover(
  { limits: { candidate_limit: 2 }, counters: { candidates_seen: 0 } },
  { industryIds: ["4"], keyword: "platform", locations: ["United States"], companySize: ["11-50", "51-200"], page: 1, requested: 2 },
);

console.log(JSON.stringify(result, null, 2));
console.log(`\nitemCount: ${result.itemCount}, normalized: ${result.candidates.length}, pool: ${result.totalResultCount}, estimatedCostUsd: ${result.estimatedCostUsd}`);

if (result.candidates.length < result.itemCount) {
  console.warn(`\nWARNING: ${result.itemCount - result.candidates.length} item(s) failed to normalize - the actor's output shape may have changed.`);
}
