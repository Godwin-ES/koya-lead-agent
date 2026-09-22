import type { SupabaseClient } from "@supabase/supabase-js";
import type { Scraper } from "../domain/types";
import { recordToolCall } from "../db/tool-calls";
import { updateRun } from "../db/runs";
import { gate, UNCOUNTED_TOOLS, type GateRunState } from "./gate";
import { isInjected } from "../providers/failure-injection";

/** What a tool handler needs beyond gate()'s own GateRunState - the run id (to write rows against), scraper choice, and any active failure-injection toggle (Task 20). */
export interface ToolRunState extends GateRunState {
  id: string;
  scraper: Scraper;
  injectedFailure?: string | null;
}

export interface ToolContext {
  supabase: SupabaseClient;
  run: ToolRunState;
}

export interface ToolHandlerResult {
  resultSummary?: string;
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
 * A handler error the runner must not treat as recoverable - unlike an
 * ordinary thrown error (which `invoke()` records and rethrows, and
 * which each runner's own per-call catch converts into a functionResult
 * error fed back to the model so it can self-correct, e.g. malformed
 * tool input), a `FatalToolError` means the underlying failure can't be
 * worked around by trying again or using a different tool - an
 * authentication failure, a dead provider. §13: "Apify auth/quota
 * error: run fails fast... no retry loop" / "Crawl4AI sidecar down:
 * run fails with an actionable message." Each runner's tool-call catch
 * block re-throws this instead of swallowing it, so it propagates all
 * the way out to the worker's own catch (service.ts), which marks the
 * run `failed` with the real reason.
 */
export class FatalToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalToolError";
  }
}

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
  await updateRun(ctx.supabase, ctx.run.id, { counters: { ...ctx.run.counters, tool_calls_used: next } });
}

/**
 * Task 20's `invalid_tool_input` toggle: fires once, on the first call
 * to `save_icp` (the agent's near-universal first tool call, so this is
 * reliably reachable), then clears itself so it doesn't re-corrupt
 * every subsequent call and loop forever - the point is to demonstrate
 * §13's "Zod error returned to the agent as a tool error so it can
 * correct itself," not to permanently break the tool.
 */
async function maybeInjectInvalidInput(
  ctx: ToolContext,
  toolName: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (toolName !== "save_icp" || !isInjected("invalid_tool_input", ctx.run.injectedFailure)) return input;
  ctx.run.injectedFailure = null;
  await updateRun(ctx.supabase, ctx.run.id, { injected_failure: null });
  return {};
}

export async function invoke(
  ctx: ToolContext,
  toolName: string,
  rawInput: Record<string, unknown>,
  handler: ToolHandler,
): Promise<ToolHandlerResult> {
  const startedAt = Date.now();
  const input = await maybeInjectInvalidInput(ctx, toolName, rawInput);
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
    });
    await bumpToolCallsUsed(ctx, toolName);
    return result;
  } catch (err) {
    await recordToolCall(ctx.supabase, {
      runId: ctx.run.id,
      toolName,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    await bumpToolCallsUsed(ctx, toolName);
    throw err;
  }
}
