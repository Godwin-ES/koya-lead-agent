#!/usr/bin/env -S npx tsx
/**
 * The ONE genuinely-live Apify call this project makes deliberately
 * (SYSTEM-DESIGN-NEXTJS.md §11, Task 10 Step 3): a 2-result capped run
 * against the real actor, used to (a) confirm its real output field
 * shape against the fixture-driven parser and (b) record its actual
 * console cost in BUILD-NOTES-NEXTJS.md.
 *
 * Never called by `pnpm check`, `pnpm test`, or any CI path - only by a
 * human running `pnpm test:live:apify-discover` and explicitly approving
 * the spend first. Requires REPLAY_MODE=false on this process only; it
 * does not change the default for anything else.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.REPLAY_MODE = "false";

const { discover, __resetSpendCacheForTests } = await import("../../packages/core/src/providers/discovery/apify");

if (!process.env.APIFY_ACTOR_ID) {
  console.error("APIFY_ACTOR_ID is not set in .env.local - nothing to run.");
  process.exit(1);
}

console.log(`Dispatching a real, capped (2-result) run against ${process.env.APIFY_ACTOR_ID}...`);
console.log("This spends real money against the shared Apify budget.");

__resetSpendCacheForTests();

const result = await discover(
  { limits: { candidate_limit: 2 }, counters: { candidates_seen: 0 } },
  { query: "organic skincare brand", requested: 2 },
);

console.log("\n--- Raw items returned ---");
console.log(JSON.stringify(result, null, 2));
console.log(
  `\nitemCount: ${result.itemCount}, parsed candidates: ${result.candidates.length}, estimatedCostUsd: ${result.estimatedCostUsd}`,
);

if (result.candidates.length < result.itemCount) {
  console.warn(
    `\nWARNING: ${result.itemCount - result.candidates.length} item(s) failed to parse into a candidate - toCandidate() field names likely don't match this actor's real output. Check the raw item shape above.`,
  );
}
