import { GoogleGenAI, createUserContent } from "@google/genai";
import type { Content, FunctionDeclaration } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { RunLimits, RunCounters, Scraper } from "@core/domain/types";
import { TOOL_DEFINITIONS, FORCE_FINALIZE } from "@core/tools/definitions";
import { invoke, ToolDeniedError, FatalToolError, type ToolRunState } from "@core/tools/log";
import { buildSystemPrompt } from "@core/skills/loader";
import { appendAgentEvent } from "@core/db/events";
import { insertCostLedgerEntry } from "@core/db/cost";
import { sumCostForRun } from "@core/db/cost";
import { getRunById, mergeRunCounters } from "@core/db/runs";
import { withRecording } from "@core/providers/replay/recorder";
import { buildPhasePrompt, type AgentSession, type OrchestratorRun } from "../orchestrator";
import { withGeminiRetry, statusOf } from "./gemini-retry";
import { classifyHttpFailure, RunFailure } from "@core/domain/failure";
import { errorMessage } from "@core/domain/errors";
import { HistoryTrimmer, type ToolOutcome } from "./history-trim";
import { buildResumeBrief } from "@core/tools/resume-brief";
import { interruptibleSleep, readStopRequest, RunStopRequested, type StopKind } from "../run-control";

let cachedClient: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!cachedClient) cachedClient = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
  return cachedClient;
}

function toFunctionDeclarations(tools?: readonly string[]): FunctionDeclaration[] {
  return TOOL_DEFINITIONS.filter((def) => !tools || tools.includes(def.name)).map((def) => ({
    name: def.name,
    description: def.description,
    parametersJsonSchema: z.toJSONSchema(def.inputSchema, { target: "draft-7" }),
  }));
}

interface RawTurnPart {
  text?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  /**
   * An opaque, per-part signature this Gemini version requires echoed
   * back verbatim on any later turn's history that includes this same
   * part - confirmed live: omitting it made every second function call
   * fail with "Function call is missing a thought_signature in
   * functionCall parts" (400 INVALID_ARGUMENT), blocking every real run
   * past its first tool call. Not documented in
   * docs/provider-findings.md because it wasn't discoverable there - the
   * bundled docs describe the request/response shapes, not this
   * server-side statefulness requirement, which only showed up against
   * the real API.
   */
  thoughtSignature?: string;
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
      thoughtSignature: p.thoughtSignature,
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
  /** Run a focused session (e.g. drafting one lead's outreach) instead of the full workflow. */
  session?: AgentSession;
}

/** `cancelled` = the worker is shutting down (the run is requeued); `user_cancelled` = the user pressed Cancel; `paused` = the user pressed Pause. */
export type GeminiStopReason = "finalized" | "max_turns" | "clarification_requested" | "cancelled" | "paused" | "user_cancelled" | "session_done";

const STOP_REASON: Record<StopKind, GeminiStopReason> = { shutdown: "cancelled", pause: "paused", user_cancel: "user_cancelled" };
const STOPPED: ReadonlySet<GeminiStopReason> = new Set(["cancelled", "paused", "user_cancelled", "session_done"]);

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
  const session = params.session;
  const functionDeclarations = toFunctionDeclarations(session?.tools);
  // A run with saved work (resumed after a pause, failure or worker
  // restart) starts from a handover note - its old conversation is gone.
  const opening = session ? session.prompt : buildPhasePrompt({ ...params.run, resumeBrief: await buildResumeBrief(params.supabase, params.run.id) });
  const history: Content[] = [createUserContent(opening)];
  const trimmer = new HistoryTrimmer(history);

  let run = params.run;
  // Cumulative across resumes, so max_turns bounds the whole run, not each session.
  let turnsUsed = run.counters.turns_used ?? 0;
  let sessionTurns = 0;
  let stopReason: GeminiStopReason | null = null;
  // A session belongs to the reviewer, not the run: only a worker shutdown
  // stops it - a finished or cancelled run's lead can still get drafts.
  const checkStop = session
    ? async () => (params.shouldStop?.() ? ("shutdown" as const) : null)
    : () => readStopRequest(params.supabase, run.id, params.shouldStop);
  const withinTurnLimit = () => (session ? sessionTurns < session.maxTurns : turnsUsed < run.limits.max_turns);

  while (withinTurnLimit() && !stopReason) {
    // Safe point: before asking the model for the next step.
    const stopBeforeTurn = await checkStop();
    if (stopBeforeTurn) {
      stopReason = STOP_REASON[stopBeforeTurn];
      break;
    }

    turnsUsed += 1;
    sessionTurns += 1;
    // Written for the run view's budget meters (Task 17) - counters.turns_used
    // otherwise never exists anywhere. A merge, not a full-column write from
    // this loop's snapshot, so it can't clobber a counter a tool just wrote.
    await mergeRunCounters(params.supabase, run.id, { turns_used: turnsUsed });

    const fixtureKey = session ? `gemini:${session.fixtureSet}:turn:${sessionTurns}` : `gemini:${params.run.fixtureSet ?? "live"}:turn:${turnsUsed}`;
    let turn: RawTurn;
    try {
      turn = await withRecording(fixtureKey, () =>
        withGeminiRetry(() => dispatchGeminiRaw({ model, systemInstruction, functionDeclarations, history }), {
          onRetry: ({ attempt, delayMs, reason }) =>
            appendAgentEvent(params.supabase, run.id, "system", { message: `Gemini ${reason} - waiting ${Math.round(delayMs / 1000)}s before retry ${attempt}` }).then(() => undefined),
          // A pause or cancel during a rate-limit wait stops the run straight away.
          sleep: interruptibleSleep(checkStop),
        }),
      );
    } catch (err) {
      if (err instanceof RunStopRequested) {
        stopReason = STOP_REASON[err.kind];
        break;
      }
      // Retries are used up: the same failure kinds as Claude, so the worker handles both runners alike.
      if (err instanceof RunFailure) throw err;
      const status = statusOf(err);
      const message = errorMessage(err);
      if (status === 429 && /PerDay/i.test(message)) {
        throw new RunFailure("account", "gemini", `The daily Gemini quota is used up - resume tomorrow or raise the quota. ${message}`);
      }
      if (status !== null) throw classifyHttpFailure("gemini", status, message);
      // No HTTP status: temporary only if it's really the network; anything
      // else (a missing replay fixture, a bug) fails as it is.
      if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|timed? ?out/i.test(message)) throw classifyHttpFailure("gemini", null, message);
      throw err;
    }

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
      // `thoughtSignature` must be echoed back on the exact part it
      // arrived on (see RawTurnPart's own comment) - attached here
      // regardless of whether that part is a functionCall or plain text,
      // since the API ties it to the part, not specifically to the
      // presence of a function call.
      parts: turn.parts.map((p) => ({
        ...(p.functionCall ? { functionCall: p.functionCall } : { text: p.text ?? "" }),
        ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}),
      })),
    });

    const text = turn.parts.find((p) => p.text)?.text;
    if (text) {
      await appendAgentEvent(params.supabase, run.id, "assistant_text", { text });
    }

    const calls = turn.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);

    if (calls.length === 0) {
      if (session) {
        stopReason = "session_done";
        break;
      }
      history.push(createUserContent("Continue using your tools, or call finalize_run if you believe you're done."));
      continue;
    }

    // Safe point: the model has decided its next steps but none has run.
    // Dropping them loses nothing - the resumed model decides again.
    const stopBeforeCalls = await checkStop();
    if (stopBeforeCalls) {
      stopReason = STOP_REASON[stopBeforeCalls];
      break;
    }

    const responseParts: NonNullable<Content["parts"]> = [];
    const outcomes: ToolOutcome[] = [];

    for (const call of calls) {
      const toolName = call.name ?? "";
      const args = call.args ?? {};

      await appendAgentEvent(params.supabase, run.id, "tool_use", { tool: toolName, args });

      try {
        const def = TOOL_DEFINITIONS.find((d) => d.name === toolName);
        if (!def) throw new ToolDeniedError(`"${toolName}" is not a recognized tool.`);
        if (session && !session.tools.includes(def.name)) throw new ToolDeniedError(`Only ${session.tools.join(", ")} can be used here.`);

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
        outcomes.push({ toolName, args, data: result.data, partIndex: responseParts.length });
        responseParts.push({
          functionResponse: { id: call.id, name: toolName, response: { output: result.modelOutput ?? result.resultSummary ?? "ok" } },
        });

        run = await refreshRunState(params.supabase, run);

        if (toolName === "finalize_run") stopReason = "finalized";
        if (toolName === "request_clarification") stopReason = "clarification_requested";
        if (!stopReason) {
          // Safe point: this step has committed; later calls in the same turn are skipped.
          const stopAfterCall = await checkStop();
          if (stopAfterCall) stopReason = STOP_REASON[stopAfterCall];
          else if (session && (await session.isDone())) stopReason = "session_done";
        }
      } catch (err) {
        // A FatalToolError (Task 20: an auth failure, a dead provider)
        // is not something the agent can work around by trying again or
        // using a different tool - it propagates out of this loop
        // entirely, up to claimAndProcessOne's own catch (service.ts),
        // which marks the run `failed`. Every other handler error stays
        // recoverable: fed back as a functionResponse error so the
        // model can self-correct (§13: malformed tool input).
        if (err instanceof FatalToolError) throw err;
        const message = err instanceof ToolDeniedError ? err.agentMessage : errorMessage(err);
        await appendAgentEvent(params.supabase, run.id, "tool_result", { tool: toolName, error: message });
        responseParts.push({ functionResponse: { id: call.id, name: toolName, response: { error: message } } });
      }

      if (stopReason && STOPPED.has(stopReason)) break;
    }

    history.push({ role: "user", parts: responseParts });
    trimmer.recordTurn(history.length - 1, outcomes);
  }

  if (stopReason && STOPPED.has(stopReason)) {
    return { turnsUsed, stopReason };
  }

  if (!stopReason && session) {
    // A session never finalizes the run - it only ran out of turns.
    return { turnsUsed, stopReason: "max_turns" };
  }

  if (!stopReason) {
    await appendAgentEvent(params.supabase, run.id, "limit_hit", { reason: "max_turns" });
    const finalizeDef = TOOL_DEFINITIONS.find((d) => d.name === "finalize_run")!;
    await invoke(
      { supabase: params.supabase, run },
      "finalize_run",
      { summary: `Stopped at the ${run.limits.max_turns}-turn limit; finalizing with what was found.`, [FORCE_FINALIZE]: true },
      finalizeDef.handler,
    );
    stopReason = "max_turns";
  }

  return { turnsUsed, stopReason };
}
