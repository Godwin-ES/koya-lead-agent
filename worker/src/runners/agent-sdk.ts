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
import { getRunById } from "@core/db/runs";
import { buildPhasePrompt, type OrchestratorRun } from "../orchestrator";

const SERVER_NAME = "lead-agent";

/**
 * Built-in tools the agent must never reach, regardless of allowlist
 * ordering (SYSTEM-DESIGN-NEXTJS.md §8: only the eight named tools are
 * usable). Exported so a test can assert on the exact set without
 * spinning up a real session - this list is itself the enforcement (via
 * `disallowedTools`), so testing that it's correct is testing the real
 * thing, not a proxy for it.
 */
export const DISALLOWED_BUILTIN_TOOLS = ["Bash", "Write", "Edit", "WebFetch", "WebSearch", "Glob", "Grep", "Task", "Read"] as const;

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

/**
 * Wraps every ToolDefinition as an SDK MCP tool, all closing over the
 * same mutable `ctxRef`/`state` so a tool call's effect (a saved ICP, an
 * incremented counter, a clarification request) is visible to the very
 * next call within the same session - refreshed after every successful
 * invoke(), same pattern as the Gemini runner's own `run` reassignment.
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
    return tool(def.name, def.description, shape, async (args) => {
      try {
        const result = await invoke({ supabase, run: ctxRef.current }, def.name, args as Record<string, unknown>, def.handler);
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
    });
  });
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
  run: ToolRunState & OrchestratorRun;
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

export async function runAgentSdk(params: RunAgentSdkParams): Promise<RunAgentSdkResult> {
  const ctxRef = { current: params.run };
  const state: LoopState = { finalized: false, clarificationRequested: false, cancelled: false };
  const tools = buildTools(ctxRef, state, params.supabase, params.shouldStop);
  const server = createSdkMcpServer({ name: SERVER_NAME, version: "1.0.0", tools });
  const toolNames = TOOL_DEFINITIONS.map((d) => `mcp__${SERVER_NAME}__${d.name}`);

  let numTurns = 0;
  let totalCostUsd = 0;

  try {
    for await (const message of query({
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
        hooks: {
          PreToolUse: [{ matcher: `mcp__${SERVER_NAME}__.*`, hooks: [buildPreToolUseHook(ctxRef)] }],
        },
      },
    }) as AsyncGenerator<SDKMessage, void>) {
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
