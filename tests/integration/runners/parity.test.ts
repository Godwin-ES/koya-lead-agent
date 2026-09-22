import { describe, expect, it } from "vitest";
import { buildTools, buildPreToolUseHook, recordModelUsage, DISALLOWED_BUILTIN_TOOLS, type LoopState } from "../../../worker/src/runners/agent-sdk";
import { gate, TOOL_NAMES } from "@core/tools/gate";
import { LIMIT_DEFAULTS } from "@core/domain/limits";
import type { ToolRunState } from "@core/tools/log";
import { createFakeSupabase } from "../../unit/tools/support/fake-supabase";

/**
 * The Agent SDK's own `query()` loop is a black box that spawns a real
 * subprocess talking to the real Anthropic API - there is no fixture
 * replay mechanism for it the way there is for our own raw fetch/Gemini
 * dispatch functions, so it cannot be exercised by an automated test
 * without violating the project-wide "no automated test makes a real
 * external call" constraint (SYSTEM-DESIGN-NEXTJS.md §11). That one real
 * exercise is the live smoke test, Task 15 Step 3 - a deliberate,
 * individually-approved action, never a side effect of `pnpm test`.
 *
 * What *is* testable, and tested here, is everything this file actually
 * wrote: the tool wrappers, the PreToolUse hook, and the cost-recording
 * logic - all plain functions that close over a Supabase client and
 * don't touch the SDK's `query()` at all. These are exactly the pieces
 * where a real bug would live (wrong gate() call, wrong error mapping,
 * wrong cost math) - the `query()` plumbing around them is thin and
 * SDK-owned.
 */

function baseRun(overrides: Partial<ToolRunState> = {}): ToolRunState {
  return {
    id: "run-1",
    icp: { target_company_type: "SaaS" },
    limits: LIMIT_DEFAULTS,
    counters: { qualified_count: 0 },
    clarificationCount: 0,
    spentUsd: 0,
    scraper: "crawl4ai",
    ...overrides,
  };
}

describe("agent-sdk runner: buildTools", () => {
  it("a successful tool call updates the shared run state and returns non-error content", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: null, counters: {}, limits: LIMIT_DEFAULTS });
    const ctxRef = { current: baseRun({ icp: null }) };
    const state: LoopState = { finalized: false, clarificationRequested: false, cancelled: false };

    const tools = buildTools(ctxRef, state, client);
    const saveIcp = tools.find((t) => t.name === "save_icp")!;

    const result = await saveIcp.handler(
      {
        target_company_type: "B2B SaaS",
        industries: [],
        geography: [],
        headcount_range: "",
        buyer_persona: "",
        business_problem: "",
        hard_filters: [],
        soft_preferences: [],
        disqualifiers: [],
      },
      {},
    );

    expect(result.isError).toBeFalsy();
    expect(ctxRef.current.icp).not.toBeNull();
  });

  it("a denied tool call still writes a tool_calls row via invoke(), and returns isError", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: null, counters: {}, limits: LIMIT_DEFAULTS });
    const ctxRef = { current: baseRun({ icp: null }) };
    const state: LoopState = { finalized: false, clarificationRequested: false, cancelled: false };

    const tools = buildTools(ctxRef, state, client);
    const discover = tools.find((t) => t.name === "discover_companies")!;

    const result = await discover.handler({ query: "saas", requested: 5 }, {});

    expect(result.isError).toBe(true);
    expect(tables.tool_calls.some((c) => c.status === "denied")).toBe(true);
  });

  it("marks state.finalized after a successful finalize_run call", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", status: "running", icp: {}, counters: {}, limits: { ...LIMIT_DEFAULTS, target_qualified: 0 } });
    const ctxRef = { current: baseRun() };
    const state: LoopState = { finalized: false, clarificationRequested: false, cancelled: false };

    const tools = buildTools(ctxRef, state, client);
    const finalize = tools.find((t) => t.name === "finalize_run")!;

    await finalize.handler({ summary: "done" }, {});

    expect(state.finalized).toBe(true);
  });
});

describe("agent-sdk runner: buildPreToolUseHook", () => {
  it("denies a call the handler would also deny, without the handler ever running", async () => {
    const { tables } = createFakeSupabase();
    const ctxRef = { current: baseRun({ icp: null }) };
    const hook = buildPreToolUseHook(ctxRef);

    const output = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "mcp__lead-agent__discover_companies",
        tool_input: { query: "saas" },
        tool_use_id: "call-1",
      } as never,
      "call-1",
      { signal: new AbortController().signal },
    );

    expect(output).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    // No handler ran, so no tool_calls row exists at all for this call.
    expect(tables.tool_calls).toHaveLength(0);
  });

  it("allows a well-formed, in-budget call", async () => {
    const ctxRef = { current: baseRun() };
    const hook = buildPreToolUseHook(ctxRef);

    const output = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "mcp__lead-agent__discover_companies",
        tool_input: { query: "saas" },
        tool_use_id: "call-1",
      } as never,
      "call-1",
      { signal: new AbortController().signal },
    );

    expect(output).toEqual({ continue: true });
  });

  it("reaches the same verdict as gate() called directly - both runners share one source of truth", async () => {
    const ctxRef = { current: baseRun({ counters: { qualified_count: 0, scrapes_used: LIMIT_DEFAULTS.scrape_limit } }) };
    const hook = buildPreToolUseHook(ctxRef);

    const hookOutput = await hook(
      { hook_event_name: "PreToolUse", tool_name: "mcp__lead-agent__scrape_site", tool_input: {}, tool_use_id: "c" } as never,
      "c",
      { signal: new AbortController().signal },
    );
    const directDecision = gate(ctxRef.current, "scrape_site", {});

    expect(directDecision.kind).toBe("deny");
    if (directDecision.kind === "deny") {
      expect((hookOutput as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason).toBe(
        directDecision.agentMessage,
      );
    }
  });
});

describe("agent-sdk runner: recordModelUsage", () => {
  it("records one cost_ledger row per model, using the sdk's own cost estimate", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1" });

    await recordModelUsage(client, "run-1", {
      "claude-haiku-4-5": {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0.0012,
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
    });

    expect(tables.cost_ledger).toHaveLength(1);
    expect(tables.cost_ledger[0]).toMatchObject({
      run_id: "run-1",
      provider: "anthropic",
      units: 1200,
      estimated_cost_usd: 0.0012,
      model: "claude-haiku-4-5",
    });
  });
});

describe("agent-sdk runner: tool surface", () => {
  it("never disallows one of our own eight tools", () => {
    for (const disallowed of DISALLOWED_BUILTIN_TOOLS) {
      expect(TOOL_NAMES).not.toContain(disallowed);
    }
  });

  it("disallows every dangerous built-in tool the agent must not reach", () => {
    for (const dangerous of ["Bash", "Write", "Edit", "WebFetch", "WebSearch", "Task"]) {
      expect(DISALLOWED_BUILTIN_TOOLS).toContain(dangerous);
    }
  });
});
