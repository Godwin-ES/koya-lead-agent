#!/usr/bin/env -S npx tsx
/**
 * Task 22: runs the fixed benchmark objective across gemini,
 * claude-haiku-4-5, claude-sonnet-5, and claude-opus-5 in REPLAY MODE -
 * $0 on every rerun, a controlled comparison since replay pins every
 * external input identical to the one real recording pass
 * (scripts/live/benchmark-record.ts) produced.
 *
 * Safe to run any time (does not require REPLAY_MODE=false, does not
 * touch a live provider), but it DOES write real rows into whatever
 * Supabase project SUPABASE_URL points at - a fresh test user and run
 * per model, cleaned up at the end - so it still needs real Supabase
 * credentials in .env.local, same as the E2E suite.
 *
 * Requires scripts/live/benchmark-record.ts to have been run at least
 * once (the fixtures + tests/fixtures/benchmark/meta/*.json this script
 * reads don't exist otherwise) and tests/fixtures/benchmark/ground-truth.json
 * to have real labels for a meaningful qualification-precision score.
 */
import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
config({ path: ".env.local" });

const { serviceRoleClient, createTestUser } = await import("../tests/integration/helpers/db");
const { runGeminiAgent } = await import("../worker/src/runners/gemini");
const { runAgentSdk } = await import("../worker/src/runners/agent-sdk");
const { LIMIT_DEFAULTS } = await import("../packages/core/src/domain/limits");
const { listLeadsForRun } = await import("../packages/core/src/db/leads");
const { listDraftsForLead } = await import("../packages/core/src/db/drafts");
const { listToolCallsForRun } = await import("../packages/core/src/db/tool-calls");
const { sumCostForRun } = await import("../packages/core/src/db/cost");
const { scoreQualification, scoreGrounding, scoreInjectionBehavior } = await import("../packages/core/src/benchmark/score");
const { fixturePathFor } = await import("../packages/core/src/providers/replay/fixtures");

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

const metaDir = path.resolve(process.cwd(), "tests/fixtures/benchmark/meta");
const groundTruthPath = path.resolve(process.cwd(), "tests/fixtures/benchmark/ground-truth.json");
const groundTruth = existsSync(groundTruthPath) ? JSON.parse(readFileSync(groundTruthPath, "utf-8")) : {};

for (const entry of MATRIX) {
  const gate = entry.runner === "gemini" ? fixturePathFor(`gemini:${FIXTURE_SET}:turn:1`) : fixturePathFor(`agent-sdk:${entry.model}:${FIXTURE_SET}`);
  if (!existsSync(gate)) {
    console.error(`No recorded fixture for "${entry.key}" (expected ${gate}).`);
    console.error("Run scripts/live/benchmark-record.ts first - see that file's own header for the cost/approval discipline.");
    process.exit(1);
  }
}

interface RunResult {
  key: string;
  runner: string;
  model: string;
  stopReason: string;
  turnsUsed: number;
  toolCallsUsed: number;
  spentUsd: number;
  wallClockMs: number | null;
  qualification: ReturnType<typeof scoreQualification>;
  grounding: ReturnType<typeof scoreGrounding>;
  injection: ReturnType<typeof scoreInjectionBehavior>;
}

const supabase = serviceRoleClient();
const user = await createTestUser();
const results: RunResult[] = [];

try {
  for (const entry of MATRIX) {
    console.log(`\n=== replaying ${entry.key} (${entry.runner}, model=${entry.model}) ===`);

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

    const result =
      entry.runner === "gemini"
        ? await runGeminiAgent({ supabase, run: runState, model: entry.model })
        : await runAgentSdk({ supabase, run: runState, model: entry.model });

    const leads = await listLeadsForRun(supabase, run.id);
    const drafts = (await Promise.all(leads.map((l) => listDraftsForLead(supabase, l.id)))).flat();
    const toolCalls = await listToolCallsForRun(supabase, run.id);
    const spentUsd = await sumCostForRun(supabase, run.id);
    const leadsById = new Map(leads.map((l) => [l.id, l]));

    const metaPath = path.join(metaDir, `${entry.key}.json`);
    const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf-8")) : null;

    const turnsUsed = "turnsUsed" in result ? result.turnsUsed : ("numTurns" in result ? result.numTurns : 0);

    results.push({
      key: entry.key,
      runner: entry.runner,
      model: entry.model,
      stopReason: result.stopReason,
      turnsUsed,
      toolCallsUsed: toolCalls.length,
      spentUsd,
      wallClockMs: meta?.wallClockMs ?? null,
      qualification: scoreQualification(leads, groundTruth),
      grounding: scoreGrounding(drafts, leadsById),
      injection: scoreInjectionBehavior(leads),
    });

    console.log(`  stopReason=${result.stopReason} turns=${turnsUsed} toolCalls=${toolCalls.length} leads=${leads.length} drafts=${drafts.length} spentUsd=${spentUsd}`);
  }
} finally {
  await user.cleanup();
}

function fmtAccuracy(a: number | null): string {
  return a === null ? "n/a (no labeled domains)" : `${Math.round(a * 100)}%`;
}
function fmtRatio(r: number | null): string {
  return r === null ? "n/a (no drafts)" : `${Math.round(r * 100)}%`;
}

const rows = results
  .map(
    (r) =>
      `| ${r.key} | ${r.stopReason} | ${r.turnsUsed} | ${r.toolCallsUsed} | $${r.spentUsd.toFixed(4)} | ${r.wallClockMs !== null ? `${(r.wallClockMs / 1000).toFixed(1)}s` : "n/a"} | ${fmtAccuracy(r.qualification.accuracy)} | ${fmtRatio(r.grounding.flaggedRatio)} | ${r.injection.flaggedLeadCount}/${r.injection.totalLeadCount} |`,
  )
  .join("\n");

const report = `# Task 22 runner/model benchmark

Fixed objective, replayed in REPLAY_MODE for every model (see
\`scripts/live/benchmark-record.ts\` for the one real recording pass that
produced these fixtures, and \`tests/fixtures/benchmark/ground-truth.json\`
for the hand-labelled qualification verdicts this compares against).

> Objective: "${OBJECTIVE}"
> Limits: target_qualified=${BENCHMARK_LIMITS.target_qualified}, candidate_limit=${BENCHMARK_LIMITS.candidate_limit}, scrape_limit=${BENCHMARK_LIMITS.scrape_limit}, max_turns=${BENCHMARK_LIMITS.max_turns}

| Model | Stop reason | Turns | Tool calls | Cost | Wall clock (live) | Qualification accuracy | Drafts flagged (unsupported claims) | Leads injection-flagged |
|---|---|---|---|---|---|---|---|---|
${rows}

Wall clock is from the one live recording pass (\`tests/fixtures/benchmark/meta/*.json\`) -
replay itself is near-instant and not a meaningful latency comparison.

Generated ${new Date().toISOString()} by \`scripts/benchmark.ts\`.
`;

const evidenceDir = path.resolve(process.cwd(), "..", "evidence", "benchmark");
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(path.join(evidenceDir, "results.md"), report);

console.log(`\n${report}`);
console.log(`Written to ${path.join(evidenceDir, "results.md")}`);
