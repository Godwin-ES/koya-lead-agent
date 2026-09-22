import type { SupabaseClient } from "@supabase/supabase-js";
import type { Scraper } from "../domain/types";
import { recordToolCall } from "../db/tool-calls";
import { gate, type GateRunState } from "./gate";

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
export async function invoke(
  ctx: ToolContext,
  toolName: string,
  input: Record<string, unknown>,
  handler: ToolHandler,
): Promise<ToolHandlerResult> {
  const startedAt = Date.now();
  const decision = gate(ctx.run, toolName, input);

  if (decision.kind === "deny") {
    await recordToolCall(ctx.supabase, {
      runId: ctx.run.id,
      toolName,
      status: "denied",
      denialReason: decision.reason,
      durationMs: Date.now() - startedAt,
    });
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
    return result;
  } catch (err) {
    await recordToolCall(ctx.supabase, {
      runId: ctx.run.id,
      toolName,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }
}
