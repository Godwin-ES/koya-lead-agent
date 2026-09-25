import type { SupabaseClient } from "@supabase/supabase-js";
import type { Scraper } from "../domain/types";
import { recordToolCall } from "../db/tool-calls";
import { updateRun, mergeRunCounters } from "../db/runs";
import { gate, UNCOUNTED_TOOLS, type GateRunState } from "./gate";
import { errorMessage } from "../domain/errors";

/** What a tool handler needs beyond gate()'s own GateRunState - the run id (to write rows against) and scraper choice. */
export interface ToolRunState extends GateRunState {
  id: string;
  scraper: Scraper;
}

export interface ToolContext {
  supabase: SupabaseClient;
  run: ToolRunState;
}

export interface ToolHandlerResult {
  /** One line for the timeline and agent_events. */
  resultSummary?: string;
  /** What the model actually receives. Falls back to resultSummary - which on its own carries no candidates or page text. */
  modelOutput?: string;
  estimatedCostUsd?: number;
  data?: unknown;
}

export type ToolHandler = (ctx: ToolContext, input: Record<string, unknown>) => Promise<ToolHandlerResult>;

/** Thrown when gate() denies a call - carries the agent-facing message, distinct from a handler's own thrown errors. */
export class ToolDeniedError extends Error {
  constructor(public readonly agentMessage: string) {
    super(agentMessage);
    this.name = "ToolDeniedError";
  }
}

/**
 * A guardrail returning the call to the agent to fix - a draft that broke
 * a writing rule, a search keyword made of criteria words, a finalize with
 * work still left. Intended behavior, not a failure: recorded as
 * `sent_back`, not `error`, and the agent receives `reasons` to act on.
 */
export class ToolSentBack extends Error {
  constructor(
    /** One line for the timeline, e.g. "Financiario email step 2 sent back". */
    public readonly summary: string,
    public readonly reasons: string[],
  ) {
    super(`${summary}:\n- ${reasons.join("\n- ")}`);
    this.name = "ToolSentBack";
  }
}

/**
 * A tool failure the run can't work around - a bad key, no credits, a
 * provider down after its retry. Unlike an ordinary thrown error (recorded,
 * then fed back to the model as a tool error so it can correct itself),
 * both runners stop the run on this and hand it to the worker, which fails
 * it or resumes it later depending on `kind` (domain/failure.ts).
 */
export { RunFailure as FatalToolError } from "../domain/failure";

/**
 * The one path every tool call goes through, runner-agnostic. Writes a
 * `tool_calls` row on every outcome - denial, error, or success (Task 12
 * Step 1's "writes a tool_calls row for a denial, not only for a
 * success") - so the evidence trail is complete regardless of which
 * runner is driving the agent. Each call inserts exactly one row once its
 * outcome is known, rather than an insert-then-update pair: `duration_ms`
 * is computed here and included in that single insert, since
 * `record_tool_call` (Task 5) is an append-only insert, not an
 * update-in-place RPC - the plan's literal "writes... and updates it
 * after" phrasing describes the guarantee (a row exists for every
 * outcome), not this specific two-step mechanism.
 */
/**
 * `gate()` reads `run.counters.tool_calls_used` to enforce
 * `max_tool_calls`, but nothing wrote it until this function did -
 * caught while wiring the run view's budget meters (Task 17), which
 * need this same number: the check was silently never true. Every
 * outcome (denied/ok/error) counts, matching what `tool_calls`' own row
 * count already reflects - a denied call still cost a wasted round
 * trip. `list_run_state` is the one exception, same as its exemption
 * from the budget check itself (§12: free and uncounted).
 */
async function bumpToolCallsUsed(ctx: ToolContext, toolName: string): Promise<void> {
  if ((UNCOUNTED_TOOLS as ReadonlySet<string>).has(toolName)) return;
  const next = (ctx.run.counters.tool_calls_used ?? 0) + 1;
  ctx.run.counters.tool_calls_used = next;
  // mergeRunCounters, not updateRun - this must never clobber a field a
  // handler wrote moments earlier in the same invoke() call (see that
  // function's own comment for the real bug this replaced).
  await mergeRunCounters(ctx.supabase, ctx.run.id, { tool_calls_used: next });
}

export async function invoke(
  ctx: ToolContext,
  toolName: string,
  rawInput: Record<string, unknown>,
  handler: ToolHandler,
): Promise<ToolHandlerResult> {
  const startedAt = Date.now();
  const input = rawInput;
  const decision = gate(ctx.run, toolName, input);

  if (decision.kind === "deny") {
    await recordToolCall(ctx.supabase, {
      runId: ctx.run.id,
      toolName,
      status: "denied",
      denialReason: decision.reason,
      durationMs: Date.now() - startedAt,
    });
    await bumpToolCallsUsed(ctx, toolName);
    throw new ToolDeniedError(decision.agentMessage);
  }

  try {
    const result = await handler(ctx, decision.input);
    await recordToolCall(ctx.supabase, {
      runId: ctx.run.id,
      toolName,
      status: "ok",
      resultSummary: result.resultSummary,
      estimatedCostUsd: result.estimatedCostUsd,
      durationMs: Date.now() - startedAt,
      resultData: result.data,
    });
    await bumpToolCallsUsed(ctx, toolName);
    return result;
  } catch (err) {
    if (err instanceof ToolSentBack) {
      await recordToolCall(ctx.supabase, {
        runId: ctx.run.id,
        toolName,
        status: "sent_back",
        resultSummary: err.summary,
        durationMs: Date.now() - startedAt,
        resultData: { reasons: err.reasons },
      });
      await bumpToolCallsUsed(ctx, toolName);
      throw err;
    }
    await recordToolCall(ctx.supabase, {
      runId: ctx.run.id,
      toolName,
      status: "error",
      errorMessage: errorMessage(err),
      durationMs: Date.now() - startedAt,
    });
    await bumpToolCallsUsed(ctx, toolName);
    throw err;
  }
}
