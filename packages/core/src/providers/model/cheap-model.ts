import type { ZodType } from "zod";
import { callClaudeStructured } from "./claude";
import { callGeminiStructured } from "./gemini";
import type { StructuredCallResult } from "./types";

export interface CheapModelOpts {
  /** A short identifier for the call, e.g. "objective-verdict", "source-summary". */
  schemaName: string;
  system?: string;
  /** Overrides RUNNER_DEFAULT for this one call. */
  runner?: "gemini" | "agent-sdk";
}

/**
 * For small, well-specified model tasks - the intake classifier, source
 * summarization, the grounding check - which always use the cheap model,
 * never the agent's own model (SYSTEM-DESIGN-NEXTJS.md §12: "deliberately
 * pairing a small model to a small task is a graded cost decision").
 *
 * Provider selection follows RUNNER_DEFAULT (gemini in dev, agent-sdk for
 * evidence runs, §4.3) unless overridden per call. Model ids come from
 * GEMINI_MODEL / ANTHROPIC_CHEAP_MODEL, never hardcoded here - the Gemini
 * one especially, since it was pinned only after confirming it live
 * against the model list (app/docs/provider-findings.md, Task 1 Step 2).
 *
 * Returns the full result, not just the data - unlike the plan's literal
 * `Promise<T>` sketch, callers need `usage` to write the cost_ledger row
 * themselves (Task 5's repos are deliberately thin; this function
 * shouldn't reach into Supabase on its own).
 */
export async function callCheapModel<T>(
  prompt: string,
  schema: ZodType<T>,
  opts: CheapModelOpts,
): Promise<StructuredCallResult<T>> {
  const runner = opts.runner ?? (process.env.RUNNER_DEFAULT === "agent-sdk" ? "agent-sdk" : "gemini");

  if (runner === "agent-sdk") {
    const model = process.env.ANTHROPIC_CHEAP_MODEL ?? "claude-haiku-4-5";
    return callClaudeStructured({ prompt, schema, schemaName: opts.schemaName, system: opts.system, model });
  }

  const model = process.env.GEMINI_MODEL;
  if (!model) {
    throw new Error("GEMINI_MODEL is not set - see .env.example (pinned in app/docs/provider-findings.md, Task 1 Step 2).");
  }
  return callGeminiStructured({ prompt, schema, schemaName: opts.schemaName, system: opts.system, model });
}
