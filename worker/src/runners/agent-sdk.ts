import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { HookCallback, PreToolUseHookInput, SDKMessage, ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodType } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunLimits, RunCounters } from "@core/domain/types";
import { TOOL_DEFINITIONS } from "@core/tools/definitions";
import { invoke, ToolDeniedError, type ToolRunState } from "@core/tools/log";
import { gate } from "@core/tools/gate";
import { buildSystemPrompt } from "@core/skills/loader";
import { appendAgentEvent } from "@core/db/events";
import { insertCostLedgerEntry, sumCostForRun } from "@core/db/cost";
import { getRunById, updateRun } from "@core/db/runs";
import { isReplayMode } from "@core/providers/replay/recorder";
import { loadFixture, saveFixture } from "@core/providers/replay/fixtures";
import { buildPhasePrompt, type OrchestratorRun } from "../orchestrator";

const SERVER_NAME = "lead-agent";

/**
 * Task 22's live benchmark recording pass found the other half of the
 * same "$0.92, zero tools called" bug alongside the `alwaysLoad` one:
 * `query()`'s subprocess inherits `process.env` by default (the SDK's own
 * docs say so explicitly), which - whenever this worker code happens to
 * run underneath another Claude Code session, as it did when driven from
 * inside this very agent's own sandbox - includes that outer session's
 * `CLAUDE_CODE_SESSION_ID`/`CLAUDE_CODE_MESSAGING_SOCKET`/
 * `CLAUDE_CODE_CHILD_SESSION` env vars. The bundled Claude Code binary
 * reads those to attach itself as a *child session* of the outer one,
 * which is exactly why the recorded fixtures show the model reaching for
 * `ToolSearch`/`Artifact`/`SendMessage`/`PushNotification` - this outer
 * session's own tools, not the worker's eight. Stripping every
 * `CLAUDE_CODE_*`/`CLAUDECODE` var (and `AI_AGENT`, another session
 * marker) before spawning keeps the subprocess a genuinely standalone
 * session regardless of what process happens to be running this code -
 * a real production deploy (Task 23) wouldn't have these vars set at
 * all, so this only ever matters in a dev/sandbox environment like this
 * one, but it's cheap insurance either way.
 */
function subprocessEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("CLAUDE_CODE_") || key === "CLAUDECODE" || key === "AI_AGENT") delete env[key];
  }
  return env;
}

/**
 * Built-in tools the agent must never reach, regardless of allowlist
 * ordering (SYSTEM-DESIGN-NEXTJS.md §8: only the eight named tools are
 * usable). Exported so a test can assert on the exact set without
 * spinning up a real session - this list is itself the enforcement (via
 * `disallowedTools`), so testing that it's correct is testing the real
 * thing, not a proxy for it.
 *
 * The second half of this list (`ToolSearch` through
 * `mcp__claude_ai_Claude_Docs__read`) was added after Task 22's live
 * benchmark recording pass: none of Task 15's original nine names cover
 * them, and every one showed up as a real, callable tool in the recorded
 * fixtures - not hypothetically, actually called (`ToolSearch`,
 * `Skill`... though `Skill` itself is legitimate, see `skills: "all"`
 * below) or offered. A `tools: []` allowlist-only approach was tried
 * first and rejected: it also hid this file's own `mcp__lead-agent__*`
 * tools, and the model started hallucinating fake XML-tag tool calls
 * instead of using real ones - worse than the bug it was meant to fix.
 * This blocklist has to be kept in sync with whatever built-ins this
 * Claude Code version ships by hand; there's no discovered allowlist
 * primitive that composes cleanly with the SDK-server tools this runner
 * actually needs.
 */
export const DISALLOWED_BUILTIN_TOOLS = [
  "Bash",
  "Write",
  "Edit",
  "WebFetch",
  "WebSearch",
  "Glob",
  "Grep",
  "Task",
  "Read",
  "ToolSearch",
  "TodoWrite",
  "Artifact",
  "ArtifactComments",
  "ArtifactData",
  "SendMessage",
  "PushNotification",
  "Monitor",
  "RemoteTrigger",
  "NotebookEdit",
  "EnterPlanMode",
  "ExitPlanMode",
  "EnterWorktree",
  "ExitWorktree",
  "DesignSync",
  "ShareOnboardingGuide",
  "CronCreate",
  "CronDelete",
  "CronList",
  "TaskStop",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
  "ListAgents",
  "ReportFindings",
  "ScheduleWakeup",
  "Workflow",
  "Agent",
  "mcp__claude_ai_Claude_Docs__read",
  "mcp__claude_ai_Claude_Docs__query",
  "mcp__claude_ai_Claude_Docs__create",
  "mcp__claude_ai_Claude_Docs__update",
  "mcp__claude_ai_Claude_Docs__delete",
  "mcp__claude_ai_Claude_Docs__batch",
  "mcp__claude_ai_Claude_Docs__export",
  "mcp__claude_ai_Claude_Docs__guide",
] as const;

/**
 * `worker/` - the directory holding `.claude/skills/` (Task 13) - so the
 * SDK's native skill discovery finds our five skills
 * (docs/provider-findings.md Step 1 finding #3: `cwd` must be at or below
 * that directory; our worker's cwd already is it directly).
 */
const WORKER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function refreshRunState<T extends ToolRunState>(supabase: SupabaseClient, run: T): Promise<T> {
  const row = await getRunById(supabase, run.id);
  if (!row) return run;
  const spentUsd = await sumCostForRun(supabase, run.id);
  return {
    ...run,
    icp: row.icp,
    limits: { ...run.limits, ...row.limits } as RunLimits,
    counters: { qualified_count: 0, ...(row.counters as Record<string, number>) } as RunCounters,
    clarificationCount: row.clarification_count,
    spentUsd,
  };
}

export interface LoopState {
  finalized: boolean;
  clarificationRequested: boolean;
  /** Set once a tool call completes after a shouldStop() check returns true - the outer loop breaks on the next message it processes. */
  cancelled: boolean;
}

type RawToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;

/**
 * The actual per-tool side effect, factored out from `buildTools` so it
 * can also be called directly by `replaySession` below - during replay
 * there is no live SDK subprocess to invoke it for us, so this is what
 * replays a recorded tool_use block into the same real `invoke()` call
 * (and therefore the same real DB writes) a live run would have made.
 * Closes over the same mutable `ctxRef`/`state` so a tool call's effect
 * (a saved ICP, an incremented counter, a clarification request) is
 * visible to the very next call within the same session - refreshed
 * after every successful invoke(), same pattern as the Gemini runner's
 * own `run` reassignment.
 */
function makeToolHandler(
  def: (typeof TOOL_DEFINITIONS)[number],
  ctxRef: { current: ToolRunState },
  state: LoopState,
  supabase: SupabaseClient,
  shouldStop?: () => boolean,
): RawToolHandler {
  return async (args) => {
    try {
      const result = await invoke({ supabase, run: ctxRef.current }, def.name, args, def.handler);
      ctxRef.current = await refreshRunState(supabase, ctxRef.current);

      if (def.name === "finalize_run") state.finalized = true;
      if (def.name === "request_clarification") state.clarificationRequested = true;
      // Checked only after invoke() has fully committed - "finishes
      // the current tool call" (Task 16), never interrupts one.
      if (shouldStop?.()) state.cancelled = true;

      return { content: [{ type: "text" as const, text: result.resultSummary ?? "ok" }] };
    } catch (err) {
      const message = err instanceof ToolDeniedError ? err.agentMessage : err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  };
}

/**
 * Wraps every ToolDefinition as an SDK MCP tool.
 *
 * No `def.inputSchema.parse()` call here, unlike the Gemini runner: the
 * SDK's `tool()` already validates `args` against the Zod shape we give
 * it before this handler ever runs (confirmed by `InferShape<Schema>` on
 * its handler signature) - a guarantee the Gemini runner's raw JSON
 * function-call args don't have, which is exactly why that runner
 * validates explicitly and this one doesn't need to.
 */
export function buildTools(
  ctxRef: { current: ToolRunState },
  state: LoopState,
  supabase: SupabaseClient,
  shouldStop?: () => boolean,
) {
  return TOOL_DEFINITIONS.map((def) => {
    const shape = (def.inputSchema as unknown as { shape: Record<string, ZodType> }).shape;
    return tool(def.name, def.description, shape, makeToolHandler(def, ctxRef, state, supabase, shouldStop));
  });
}

/** Same handlers as `buildTools`, keyed by bare tool name instead of wrapped as SDK tool() objects - what `replaySession` calls directly. */
export function buildRawToolHandlers(
  ctxRef: { current: ToolRunState },
  state: LoopState,
  supabase: SupabaseClient,
  shouldStop?: () => boolean,
): Record<string, RawToolHandler> {
  return Object.fromEntries(TOOL_DEFINITIONS.map((def) => [def.name, makeToolHandler(def, ctxRef, state, supabase, shouldStop)]));
}

/**
 * Primary enforcement, matching docs/provider-findings.md's "MAJOR
 * CORRECTION": our own MCP tools are allow-listed (required for a
 * headless worker to run without an interactive permission prompt), so
 * `canUseTool` never fires for them - a `PreToolUse` hook is the layer
 * that gives a clean denial *before* the handler runs. The handler itself
 * (buildTools, above, via invoke()) calls gate() again regardless, so a
 * hook misregistration or matcher mismatch is not the only thing standing
 * between the model and an over-budget call.
 */
export function buildPreToolUseHook(ctxRef: { current: ToolRunState }): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return { continue: true };
    const preInput = input as PreToolUseHookInput;
    const bareName = preInput.tool_name.replace(`mcp__${SERVER_NAME}__`, "");
    const decision = gate(ctxRef.current, bareName, (preInput.tool_input ?? {}) as Record<string, unknown>);

    if (decision.kind === "deny") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: decision.agentMessage,
        },
      };
    }
    return { continue: true };
  };
}

export interface RunAgentSdkParams {
  supabase: SupabaseClient;
  run: ToolRunState & OrchestratorRun & { fixtureSet?: string | null };
  model?: string;
  /** See RunGeminiAgentParams.shouldStop (worker/src/runners/gemini.ts) - same contract, same Task 16 graceful-shutdown use. */
  shouldStop?: () => boolean;
}

export type AgentSdkStopReason = "finalized" | "max_turns" | "clarification_requested" | "cancelled";

export interface RunAgentSdkResult {
  stopReason: AgentSdkStopReason;
  numTurns: number;
  totalCostUsd: number;
}

/**
 * Extracted so it's testable without a real session: a hand-built
 * `modelUsage` map (shaped exactly like the SDK's own result message
 * field) drives the same cost_ledger writes a real result would.
 * provider-findings.md finding #7 applies here: these are client-side
 * estimates, not billing truth - stored as such, cross-checked against
 * the Console during Task 23's live pass.
 */
export async function recordModelUsage(
  supabase: SupabaseClient,
  runId: string,
  modelUsage: Record<string, ModelUsage>,
): Promise<void> {
  for (const [modelName, usage] of Object.entries(modelUsage)) {
    await insertCostLedgerEntry(supabase, {
      run_id: runId,
      provider: "anthropic",
      unit_type: "tokens",
      units: usage.inputTokens + usage.outputTokens,
      estimated_cost_usd: usage.costUSD,
      model: modelName,
      ref: null,
    });
  }
}

/** A JSON-round-tripped `SDKMessage` - see `recordSession`'s note on why the round trip matters. */
type RawSdkMessage = Record<string, unknown>;

/**
 * SYSTEM-DESIGN-NEXTJS.md §11: "Every external call goes through a
 * recorder - including model calls." Unlike the Gemini runner (a manual
 * loop where each turn is one discrete HTTP dispatch, naturally wrapped
 * by `withRecording`), the Claude Agent SDK's `query()` owns its entire
 * multi-turn loop internally, including invoking our tool handlers - so
 * there is no single per-turn dispatch call to wrap. The recordable unit
 * here is the whole session's message stream instead.
 *
 * Live mode: iterate the real `query()` generator, collecting every
 * message as it's yielded (JSON round-tripped - some `SDKMessage`
 * variants expose fields via class-instance getters that
 * `JSON.stringify` drops, the same trap `dispatchGeminiRaw`'s own
 * comment documents for the Gemini SDK's response type). Saved once the
 * generator finishes (or throws), so a real crash mid-session still
 * yields a partial-but-honest recording rather than nothing.
 */
export async function* recordSession(fixtureKey: string, live: AsyncGenerator<SDKMessage, void>): AsyncGenerator<SDKMessage, void> {
  const recorded: RawSdkMessage[] = [];
  try {
    for await (const message of live) {
      recorded.push(JSON.parse(JSON.stringify(message)) as RawSdkMessage);
      yield message;
    }
  } finally {
    saveFixture(fixtureKey, recorded);
  }
}

/**
 * Replay mode: no live subprocess exists to run our tools for us, so
 * this is what stands in for it. Replays the recorded message stream
 * verbatim (for the same event-logging/turn-counting code below to
 * process identically either way), and - the one thing genuinely new
 * here versus the Gemini runner's replay, which only ever replays a
 * *dispatch response* - re-executes every recorded `tool_use` block
 * through the real raw handler (`buildRawToolHandlers`), in the exact
 * order it happened live. That reproduces the same real `invoke()` calls
 * and therefore the same real DB writes (leads, drafts, counters) a live
 * run made, deterministically, for $0: the tool handlers' own external
 * calls (Apify/Crawl4AI/Firecrawl) are independently fixture-backed via
 * their own `withRecording` wrapping, so nothing here touches a live
 * provider either.
 */
export async function* replaySession(fixtureKey: string, rawHandlers: Record<string, RawToolHandler>): AsyncGenerator<SDKMessage, void> {
  const messages = loadFixture<RawSdkMessage[]>(fixtureKey);
  for (const raw of messages) {
    const message = raw as unknown as SDKMessage;
    yield message;

    if (raw.type === "assistant") {
      const content = ((raw as { message?: { content?: unknown[] } }).message?.content ?? []) as Array<{
        type?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        const bareName = (block.name ?? "").replace(`mcp__${SERVER_NAME}__`, "");
        const handler = rawHandlers[bareName];
        if (handler) await handler(block.input ?? {});
      }
    }
  }
}

export async function runAgentSdk(params: RunAgentSdkParams): Promise<RunAgentSdkResult> {
  const ctxRef = { current: params.run };
  const state: LoopState = { finalized: false, clarificationRequested: false, cancelled: false };
  const tools = buildTools(ctxRef, state, params.supabase, params.shouldStop);
  // Task 22's live benchmark recording pass found this the hard way ($0.92
  // spent on three sessions that never called a single real tool): this SDK
  // version defers a server's tools behind tool search by default ("tools
  // are deferred when tool search is enabled"), and our own eight tools are
  // the *entire* point of this agent - there is nothing else it should be
  // discovering. `alwaysLoad: true` (`defer_loading: false` on the API)
  // keeps them in the prompt from turn one, matching `allowedTools`'
  // already-explicit intent that these are the only tools that exist here.
  const server = createSdkMcpServer({ name: SERVER_NAME, version: "1.0.0", tools, alwaysLoad: true });
  const toolNames = TOOL_DEFINITIONS.map((d) => `mcp__${SERVER_NAME}__${d.name}`);

  let numTurns = 0;
  let totalCostUsd = 0;

  const fixtureKey = `agent-sdk:${params.model ?? process.env.ANTHROPIC_MODEL ?? "default"}:${params.run.fixtureSet ?? "live"}`;

  try {
    const liveOrReplayed = isReplayMode()
      ? replaySession(fixtureKey, buildRawToolHandlers(ctxRef, state, params.supabase, params.shouldStop))
      : recordSession(
          fixtureKey,
          query({
            prompt: buildPhasePrompt(params.run),
            options: {
              model: params.model ?? process.env.ANTHROPIC_MODEL,
              systemPrompt: { type: "custom", prompt: buildSystemPrompt({ runner: "agent-sdk" }) },
              mcpServers: { [SERVER_NAME]: server },
              settingSources: ["project"],
              skills: "all",
              allowedTools: toolNames,
              disallowedTools: [...DISALLOWED_BUILTIN_TOOLS],
              maxTurns: params.run.limits.max_turns,
              cwd: WORKER_ROOT,
              env: subprocessEnv(),
              hooks: {
                PreToolUse: [{ matcher: `mcp__${SERVER_NAME}__.*`, hooks: [buildPreToolUseHook(ctxRef)] }],
              },
            },
          }) as AsyncGenerator<SDKMessage, void>,
        );

    for await (const message of liveOrReplayed) {
      if (message.type === "system" && message.subtype === "init") {
        await appendAgentEvent(params.supabase, params.run.id, "skill_load", { skills: message.skills });
      }

      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") {
            await appendAgentEvent(params.supabase, params.run.id, "assistant_text", { text: block.text });
          }
          if (block.type === "tool_use") {
            await appendAgentEvent(params.supabase, params.run.id, "tool_use", { tool: block.name, args: block.input });
          }
        }
      }

      if (message.type === "result") {
        numTurns = message.num_turns;
        totalCostUsd = message.total_cost_usd;
        await recordModelUsage(params.supabase, params.run.id, message.modelUsage ?? {});
        // Written for the run view's budget meters (Task 17) - same gap
        // as the Gemini runner's turns_used, fixed the same way.
        await updateRun(params.supabase, params.run.id, {
          counters: { ...ctxRef.current.counters, turns_used: numTurns },
        });
      }

      // Checked once per message, after any tool call in it has already
      // committed - breaking `for await` here closes the underlying async
      // generator (and the SDK's subprocess with it) without waiting for
      // more turns.
      if (state.cancelled) break;
    }
  } catch (err) {
    // CORRECTION to docs/provider-findings.md finding #6 (confirmed live,
    // Task 15 Step 3): hitting maxTurns does not always surface as a
    // `result` message with `is_error: true` the way the docs describe -
    // in this SDK version it throws directly from the async generator
    // ("Claude Code returned an error result: Reached maximum number of
    // turns (N)"), which an unguarded `for await` propagates straight
    // out of this function. Any tool calls that already succeeded before
    // the throw already committed via invoke() (ctxRef.current reflects
    // them), so this is handled exactly like a graceful max-turns stop -
    // the run still gets finalized with whatever it has, not left
    // hanging or marked failed for a limit it was always going to hit.
    await appendAgentEvent(params.supabase, params.run.id, "system", {
      note: "query() ended with an exception rather than an error result message",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (state.cancelled) {
    return { stopReason: "cancelled", numTurns, totalCostUsd };
  }

  if (!state.finalized && !state.clarificationRequested) {
    // Hitting maxTurns ends the query with an error result and does not
    // finalize anything automatically (docs/provider-findings.md finding
    // #8) - same safety-valve pattern as the Gemini runner.
    await appendAgentEvent(params.supabase, params.run.id, "limit_hit", { reason: "max_turns" });
    const finalizeDef = TOOL_DEFINITIONS.find((d) => d.name === "finalize_run")!;
    await invoke(
      { supabase: params.supabase, run: ctxRef.current },
      "finalize_run",
      { summary: `Stopped at the ${params.run.limits.max_turns}-turn limit; finalizing with what was found.` },
      finalizeDef.handler,
    );
  }

  const stopReason: AgentSdkStopReason = state.clarificationRequested
    ? "clarification_requested"
    : state.finalized
      ? "finalized"
      : "max_turns";

  return { stopReason, numTurns, totalCostUsd };
}
