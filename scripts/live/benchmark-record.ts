#!/usr/bin/env -S npx tsx
/**
 * Task 22's live recording pass (SYSTEM-DESIGN-NEXTJS.md §11's "every
 * external call goes through a recorder" - this is the one-time real
 * call that produces the fixtures `scripts/benchmark.ts` then replays
 * for $0 on every rerun). Runs ONE fixed objective/ICP across all four
 * runner/model combinations, recording each session as a fixture:
 *
 *   - gemini                 -> tests/fixtures/gemini/benchmark-v1/turn/*.json
 *   - agent-sdk/claude-haiku-4-5  -> tests/fixtures/agent-sdk/claude-haiku-4-5/benchmark-v1.json
 *   - agent-sdk/claude-sonnet-5   -> tests/fixtures/agent-sdk/claude-sonnet-5/benchmark-v1.json
 *   - agent-sdk/claude-opus-5     -> tests/fixtures/agent-sdk/claude-opus-5/benchmark-v1.json
 *
 * Every discover_companies/scrape_site call is itself independently
 * fixture-backed (Apify/Crawl4AI, via their own withRecording wrapping)
 * AND cached in Supabase's discovery_cache/scrape_cache tables - so only
 * the FIRST model to call discover_companies/scrape_site with a given
 * query/URL spends real Apify money; every later model in this same
 * script run that asks for the same query/URL gets "(no spend)". Models
 * are free to phrase their own discover_companies query differently,
 * though, so this is a likely saving, not a guarantee - the real spend
 * is whatever the console shows afterward, recorded in BUILD-NOTES, not
 * assumed here.
 *
 * Never called by `pnpm check`, `pnpm test`, or any CI path - only by a
 * human running this script directly, after approving the estimated
 * spend (same discipline as scripts/live/agent-sdk-smoke.ts and
 * scripts/live/apify-discover.ts).
 */
import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
config({ path: ".env.local" });
process.env.REPLAY_MODE = "false";

const { serviceRoleClient, createTestUser } = await import("../../tests/integration/helpers/db");
const { runGeminiAgent } = await import("../../worker/src/runners/gemini");
const { runAgentSdk } = await import("../../worker/src/runners/agent-sdk");
const { LIMIT_DEFAULTS } = await import("../../packages/core/src/domain/limits");
const { listLeadsForRun } = await import("../../packages/core/src/db/leads");
const { listToolCallsForRun } = await import("../../packages/core/src/db/tool-calls");
const { sumCostForRun } = await import("../../packages/core/src/db/cost");

for (const key of ["GOOGLE_AI_API_KEY", "ANTHROPIC_API_KEY", "APIFY_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`${key} is not set in .env.local - nothing to run.`);
    process.exit(1);
  }
}

const FIXTURE_SET = "benchmark-v1";
const OBJECTIVE = "Find US-based B2B logistics software companies with 20-100 employees, selling to warehouse operators";
const BENCHMARK_LIMITS = {
  ...LIMIT_DEFAULTS,
  target_qualified: 3,
  candidate_limit: 8,
  scrape_limit: 10,
  max_turns: 15,
  max_tool_calls: 30,
};

interface MatrixEntry {
  key: string;
  runner: "gemini" | "agent-sdk";
  model: string;
}

const MATRIX: MatrixEntry[] = [
  { key: "gemini", runner: "gemini", model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash" },
  { key: "claude-haiku-4-5", runner: "agent-sdk", model: "claude-haiku-4-5" },
  { key: "claude-sonnet-5", runner: "agent-sdk", model: "claude-sonnet-5" },
  { key: "claude-opus-5", runner: "agent-sdk", model: "claude-opus-5" },
];

console.log(`Recording ${MATRIX.length} live sessions against a fixed objective:\n  "${OBJECTIVE}"\n`);
console.log("This spends real money against Google AI, Anthropic, and (at least once) Apify.\n");

const supabase = serviceRoleClient();
const user = await createTestUser();
const metaOutDir = path.resolve(process.cwd(), "tests/fixtures/benchmark/meta");
mkdirSync(metaOutDir, { recursive: true });
const failures: Array<{ key: string; message: string }> = [];

try {
  for (const entry of MATRIX) {
    console.log(`\n=== ${entry.key} (${entry.runner}, model=${entry.model}) ===`);

    const MAX_ATTEMPTS = 3;
    let attempt = 0;
    let succeeded = false;

    while (attempt < MAX_ATTEMPTS && !succeeded) {
      attempt += 1;
      try {
        const { data: run, error } = await supabase
          .from("runs")
          .insert({
            user_id: user.userId,
            objective_raw: OBJECTIVE,
            status: "running",
            icp: null,
            limits: BENCHMARK_LIMITS,
            counters: {},
            fixture_set: FIXTURE_SET,
          })
          .select()
          .single();
        if (error) throw error;

        const runState = {
          id: run.id,
          icp: null,
          limits: run.limits,
          counters: { qualified_count: 0 },
          clarificationCount: 0,
          spentUsd: 0,
          scraper: "crawl4ai" as const,
          objectiveRaw: run.objective_raw,
          fixtureSet: FIXTURE_SET,
        };

        const startedAt = Date.now();
        const result =
          entry.runner === "gemini"
            ? await runGeminiAgent({ supabase, run: runState, model: entry.model })
            : await runAgentSdk({ supabase, run: runState, model: entry.model });
        const wallClockMs = Date.now() - startedAt;

        const leads = await listLeadsForRun(supabase, run.id);
        const toolCalls = await listToolCallsForRun(supabase, run.id);
        const spentUsd = await sumCostForRun(supabase, run.id);

        console.log(`stopReason=${result.stopReason} wallClockMs=${wallClockMs} leads=${leads.length} toolCalls=${toolCalls.length} spentUsd=${spentUsd}`);
        console.log(`Candidate domains discovered: ${leads.map((l) => l.company_domain).join(", ") || "(none)"}`);

        writeFileSync(
          path.join(metaOutDir, `${entry.key}.json`),
          JSON.stringify({ key: entry.key, runner: entry.runner, model: entry.model, runId: run.id, wallClockMs, stopReason: result.stopReason }, null, 2) + "\n",
        );
        succeeded = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  attempt ${attempt}/${MAX_ATTEMPTS} failed: ${message}`);
        if (attempt < MAX_ATTEMPTS) {
          const backoffMs = 10_000 * attempt;
          console.error(`  retrying in ${backoffMs / 1000}s (a failed call spends nothing - only a completed one is billed)...`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        } else {
          failures.push({ key: entry.key, message });
          console.error(`  giving up on "${entry.key}" after ${MAX_ATTEMPTS} attempts - continuing with the rest of the matrix.`);
        }
      }
    }
  }

  console.log(
    "\nDone. Fixtures written under tests/fixtures/gemini/benchmark-v1/ and tests/fixtures/agent-sdk/<model>/benchmark-v1.json, " +
      "plus per-model timing metadata under tests/fixtures/benchmark/meta/.\n" +
      "Next: hand-label tests/fixtures/benchmark/ground-truth.json against the discovered domains printed above (a real, blind label per domain, " +
      "not copied from any model's own verdict), then run `pnpm tsx scripts/benchmark.ts` to score all four in replay mode for $0.",
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} entr${failures.length === 1 ? "y" : "ies"} could not be recorded after ${3} attempts each:`);
    for (const f of failures) console.error(`  - ${f.key}: ${f.message}`);
    console.error("Re-run this script later (e.g. once the provider outage clears) - already-recorded entries are untouched and won't be re-billed unless you delete their fixture files.");
  }
} finally {
  await user.cleanup();
}
