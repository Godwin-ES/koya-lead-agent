#!/usr/bin/env -S npx tsx
/**
 * The Agent SDK live smoke test (Task 15 Step 3, SYSTEM-DESIGN-NEXTJS.md
 * §21.4's "early Agent SDK milestone"): one real, human-approved
 * end-to-end run of worker/src/runners/agent-sdk.ts against the real
 * Anthropic API, on the cheap model, with a deliberately tiny turn
 * budget so it stays short and cheap regardless of what the model
 * decides to do. This is one of the project's five genuinely-live
 * moments (design §11) - never called by `pnpm check`, `pnpm test`, or
 * any CI path, only by a human running this script directly and
 * approving the spend first.
 *
 * Confirms the whole real chain works, not just typechecks: the bundled
 * Claude Code binary actually launches (the real risk
 * docs/provider-findings.md finding #9 flags for the Dockerfile), our
 * MCP tools register and are callable, the PreToolUse hook enforces
 * gate(), and a real result message's cost fields land in cost_ledger.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.REPLAY_MODE = "false";

const { serviceRoleClient, createTestUser } = await import("../../tests/integration/helpers/db");
const { runAgentSdk } = await import("../../worker/src/runners/agent-sdk");
const { LIMIT_DEFAULTS } = await import("../../packages/core/src/domain/limits");
const { listToolCallsForRun } = await import("../../packages/core/src/db/tool-calls");

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set in .env.local - nothing to run.");
  process.exit(1);
}

const MODEL = process.env.SMOKE_MODEL ?? "claude-haiku-4-5";
console.log(`Running one real Agent SDK query() against ${MODEL}...`);
console.log("This spends real money against the Anthropic API.");

const supabase = serviceRoleClient();
const user = await createTestUser();

try {
  const { data: run, error } = await supabase
    .from("runs")
    .insert({
      user_id: user.userId,
      objective_raw: "Find one US B2B SaaS company with 10-100 employees",
      status: "running",
      icp: null,
      limits: { ...LIMIT_DEFAULTS, max_turns: 2, target_qualified: 1, candidate_limit: 3, scrape_limit: 2 },
      counters: {},
    })
    .select()
    .single();
  if (error) throw error;

  const result = await runAgentSdk({
    supabase,
    model: MODEL,
    run: {
      id: run.id,
      icp: null,
      limits: run.limits,
      counters: { qualified_count: 0 },
      clarificationCount: 0,
      spentUsd: 0,
      scraper: "crawl4ai",
      objectiveRaw: run.objective_raw,
    },
  });

  console.log("\n--- Result ---");
  console.log(JSON.stringify(result, null, 2));

  const calls = await listToolCallsForRun(supabase, run.id);
  console.log(`\n${calls.length} tool call(s) recorded:`);
  for (const call of calls) {
    console.log(`  seq ${call.seq}: ${call.tool_name} -> ${call.status}${call.denial_reason ? ` (${call.denial_reason})` : ""}`);
  }

  console.log(`\nReal cost per the SDK's own estimate: $${result.totalCostUsd}. Cross-check against the Anthropic Console's usage page (docs/provider-findings.md finding #6 - this number is an estimate, not billing truth).`);
} finally {
  await user.cleanup();
}
