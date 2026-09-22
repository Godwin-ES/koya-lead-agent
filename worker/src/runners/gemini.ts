import { GoogleGenAI, createUserContent } from "@google/genai";
import type { Content, FunctionDeclaration } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { RunLimits, RunCounters, Scraper } from "@core/domain/types";
import { TOOL_DEFINITIONS } from "@core/tools/definitions";
import { invoke, ToolDeniedError, FatalToolError, type ToolRunState } from "@core/tools/log";
import { buildSystemPrompt } from "@core/skills/loader";
import { appendAgentEvent } from "@core/db/events";
import { insertCostLedgerEntry } from "@core/db/cost";
import { sumCostForRun } from "@core/db/cost";
import { getRunById, updateRun } from "@core/db/runs";
import { withRecording } from "@core/providers/replay/recorder";
import { isInjected } from "@core/providers/failure-injection";
import { buildPhasePrompt, type OrchestratorRun } from "../orchestrator";

let cachedClient: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!cachedClient) cachedClient = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
  return cachedClient;
}

function toFunctionDeclarations(): FunctionDeclaration[] {
  return TOOL_DEFINITIONS.map((def) => ({
    name: def.name,
    description: def.description,
    parametersJsonSchema: z.toJSONSchema(def.inputSchema, { target: "draft-7" }),
  }));
}

interface RawTurnPart {
  text?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
}

interface RawTurn {
  parts: RawTurnPart[];
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * The only function that calls the real Gemini API. Returns a plain,
 * JSON-serializable shape (`RawTurn`), deliberately not the SDK's
 * `GenerateContentResponse` class - that class exposes `.text` and
 * `.functionCalls` as getters defined on its prototype, which
 * `JSON.stringify`/`JSON.parse` (what `withRecording`'s fixture
 * round-trip does) silently drops: a replayed fixture would come back as
 * a plain object with neither getter, breaking every call site that used
 * them. Normalizing to plain data here means the rest of this file reads
 * identically from a live call or a replayed fixture.
 */
async function dispatchGeminiRaw(args: {
  model: string;
  systemInstruction: string;
  functionDeclarations: FunctionDeclaration[];
  history: Content[];
}): Promise<RawTurn> {
  const client = getClient();
  const response = await client.models.generateContent({
    model: args.model,
    contents: args.history,
    config: {
      systemInstruction: args.systemInstruction,
      tools: [{ functionDeclarations: args.functionDeclarations }],
    },
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return {
    parts: parts.map((p) => ({
      text: p.text,
      functionCall: p.functionCall ? { id: p.functionCall.id, name: p.functionCall.name, args: p.functionCall.args } : undefined,
    })),
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

/** Rough placeholder pending real Gemini Flash pricing confirmation - same "flag it, don't invent it" discipline as the Apify/Firecrawl unit costs. */
const GEMINI_EST_COST_PER_1K_TOKENS_USD = Number(process.env.GEMINI_EST_COST_PER_1K_TOKENS_USD ?? "0.0002");

async function refreshRunState<T extends ToolRunState>(supabase: SupabaseClient, run: T): Promise<T> {
  const row = await getRunById(supabase, run.id);
  if (!row) return run;
  const spentUsd = await sumCostForRun(supabase, run.id);
  return {
    ...run,
    icp: row.icp,
    limits: { ...run.limits, ...row.limits } as RunLimits,
    // `qualified_count` is deliberately never written into runs.counters
    // (Task 12: it's always derived live from `leads`, never tracked as
    // a counter that could drift) - defaulted here only to satisfy
    // RunCounters' shape, never read by gate().
    counters: { qualified_count: 0, ...(row.counters as Record<string, number>) } as RunCounters,
    clarificationCount: row.clarification_count,
    spentUsd,
  };
}

export interface RunGeminiAgentParams {
  supabase: SupabaseClient;
  run: ToolRunState & OrchestratorRun & { fixtureSet?: string | null };
  model?: string;
  /**
   * Checked after each fully-completed tool call (never mid-call) - lets
   * the worker (Task 16) request a graceful stop for SIGTERM without
   * interrupting a write in progress. Returning true stops the loop with
   * `stopReason: "cancelled"` and deliberately skips the max-turns
   * auto-finalize path: a cancelled run should be requeued, not closed
   * out with whatever partial data it happened to have.
   */
  shouldStop?: () => boolean;
}

export type GeminiStopReason = "finalized" | "max_turns" | "clarification_requested" | "cancelled";

export interface RunGeminiAgentResult {
  turnsUsed: number;
  stopReason: GeminiStopReason;
}

/**
 * The Gemini agentic loop: calls the model with the tool declarations,
 * dispatches every function call through the same gate/invoke path as
 * every other caller, feeds results back, and repeats until the model
 * finalizes, asks for clarification, or the turn limit is hit - in which
 * case this function finalizes the run itself, since nothing else will
 * (mirrors docs/provider-findings.md's Agent SDK finding #8: hitting a
 * turn/step limit ends the loop with no automatic finalization).
 */
export async function runGeminiAgent(params: RunGeminiAgentParams): Promise<RunGeminiAgentResult> {
  const model = params.model ?? process.env.GEMINI_MODEL;
  if (!model) throw new Error("GEMINI_MODEL is not set - see .env.example.");

  const systemInstruction = buildSystemPrompt({ runner: "gemini" });
  const functionDeclarations = toFunctionDeclarations();
  const history: Content[] = [createUserContent(buildPhasePrompt(params.run))];

  let run = params.run;
  let turnsUsed = 0;
  let stopReason: GeminiStopReason | null = null;

  while (turnsUsed < run.limits.max_turns && !stopReason) {
    turnsUsed += 1;
    // Written for the run view's budget meters (Task 17) - counters.turns_used
    // otherwise never exists anywhere, only ever held in this loop's local variable.
    await updateRun(params.supabase, run.id, { counters: { ...run.counters, turns_used: turnsUsed } });

    // Task 20 failure injection (§13: "Model API 429 / 5xx"). Checked
    // once, on the first turn, before any real or replayed dispatch -
    // simulates the model provider itself failing, which propagates up
    // through claimAndProcessOne's catch and marks the run failed with
    // the reason, the same terminal state a genuine persistent 429
    // would produce.
    if (turnsUsed === 1 && isInjected("model_429", run.injectedFailure)) {
      throw new Error("Gemini API error: 429 Too Many Requests (rate limit exceeded).");
    }

    const fixtureKey = `gemini:${params.run.fixtureSet ?? "live"}:turn:${turnsUsed}`;
    const turn = await withRecording(fixtureKey, () =>
      dispatchGeminiRaw({ model, systemInstruction, functionDeclarations, history }),
    );

    const totalTokens = turn.usage.inputTokens + turn.usage.outputTokens;
    if (totalTokens > 0) {
      await insertCostLedgerEntry(params.supabase, {
        run_id: run.id,
        provider: "google",
        unit_type: "tokens",
        units: totalTokens,
        estimated_cost_usd: (totalTokens / 1000) * GEMINI_EST_COST_PER_1K_TOKENS_USD,
        model,
        ref: `turn-${turnsUsed}`,
      });
    }

    history.push({
      role: "model",
      parts: turn.parts.map((p) => (p.functionCall ? { functionCall: p.functionCall } : { text: p.text ?? "" })),
    });

    const text = turn.parts.find((p) => p.text)?.text;
    if (text) {
      await appendAgentEvent(params.supabase, run.id, "assistant_text", { text });
    }

    const calls = turn.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);

    if (calls.length === 0) {
      history.push(createUserContent("Continue using your tools, or call finalize_run if you believe you're done."));
      continue;
    }

    const responseParts: Content["parts"] = [];

    for (const call of calls) {
      const toolName = call.name ?? "";
      const args = call.args ?? {};

      await appendAgentEvent(params.supabase, run.id, "tool_use", { tool: toolName, args });

      try {
        const def = TOOL_DEFINITIONS.find((d) => d.name === toolName);
        if (!def) throw new ToolDeniedError(`"${toolName}" is not a recognized tool.`);

        // Schema validation happens *inside* the handler invoke() wraps,
        // not before it - a malformed tool call still needs a tool_calls
        // row (Task 12's "a row for every outcome" guarantee), which
        // only invoke()'s own try/catch writes. Validating before calling
        // invoke() would let a ZodError skip that row entirely.
        const result = await invoke({ supabase: params.supabase, run }, toolName, args, async (ctx, rawInput) => {
          const parsedInput = def.inputSchema.parse(rawInput) as Record<string, unknown>;
          return def.handler(ctx, parsedInput);
        });

        await appendAgentEvent(params.supabase, run.id, "tool_result", { tool: toolName, summary: result.resultSummary });
        responseParts.push({
          functionResponse: { id: call.id, name: toolName, response: { output: result.resultSummary ?? "ok" } },
        });

        run = await refreshRunState(params.supabase, run);

        if (toolName === "finalize_run") stopReason = "finalized";
        if (toolName === "request_clarification") stopReason = "clarification_requested";
        if (!stopReason && params.shouldStop?.()) stopReason = "cancelled";
      } catch (err) {
        // A FatalToolError (Task 20: an auth failure, a dead provider)
        // is not something the agent can work around by trying again or
        // using a different tool - it propagates out of this loop
        // entirely, up to claimAndProcessOne's own catch (service.ts),
        // which marks the run `failed`. Every other handler error stays
        // recoverable: fed back as a functionResponse error so the
        // model can self-correct (§13: malformed tool input).
        if (err instanceof FatalToolError) throw err;
        const message = err instanceof ToolDeniedError ? err.agentMessage : err instanceof Error ? err.message : String(err);
        await appendAgentEvent(params.supabase, run.id, "tool_result", { tool: toolName, error: message });
        responseParts.push({ functionResponse: { id: call.id, name: toolName, response: { error: message } } });
      }

      if (stopReason === "cancelled") break;
    }

    history.push({ role: "user", parts: responseParts });
  }

  if (stopReason === "cancelled") {
    return { turnsUsed, stopReason };
  }

  if (!stopReason) {
    await appendAgentEvent(params.supabase, run.id, "limit_hit", { reason: "max_turns" });
    const finalizeDef = TOOL_DEFINITIONS.find((d) => d.name === "finalize_run")!;
    await invoke(
      { supabase: params.supabase, run },
      "finalize_run",
      { summary: `Stopped at the ${run.limits.max_turns}-turn limit; finalizing with what was found.` },
      finalizeDef.handler,
    );
    stopReason = "max_turns";
  }

  return { turnsUsed, stopReason };
}
