import { existsSync, readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildTools,
  buildRawToolHandlers,
  buildPreToolUseHook,
  recordModelUsage,
  recordSession,
  replaySession,
  DISALLOWED_BUILTIN_TOOLS,
  type LoopState,
} from "../../../worker/src/runners/agent-sdk";
import { gate, TOOL_NAMES } from "@core/tools/gate";
import { LIMIT_DEFAULTS } from "@core/domain/limits";
import type { ToolRunState } from "@core/tools/log";
import { fixturePathFor, saveFixture } from "@core/providers/replay/fixtures";
import { createFakeSupabase } from "../../unit/tools/support/fake-supabase";

/**
 * The Agent SDK's own `query()` loop is a black box that spawns a real
 * subprocess talking to the real Anthropic API - it cannot be exercised
 * by an automated test without violating the project-wide "no automated
 * test makes a real external call" constraint (SYSTEM-DESIGN-NEXTJS.md
 * §11). That one real exercise is the live smoke test, Task 15 Step 3 -
 * a deliberate, individually-approved action, never a side effect of
 * `pnpm test`.
 *
 * What *is* testable, and tested here, is everything this file actually
 * wrote: the tool wrappers, the PreToolUse hook, the cost-recording
 * logic, and - Task 22 - `recordSession`/`replaySession`, the
 * session-level recorder that stands in for `query()` in replay mode.
 * These are all plain functions that close over a Supabase client (or, for
 * the session helpers, a plain async generator) and don't touch the
 * SDK's `query()` at all. These are exactly the pieces where a real bug
 * would live (wrong gate() call, wrong error mapping, wrong cost math,
 * a tool_use block replayed out of order) - the `query()` plumbing
 * around them is thin and SDK-owned.
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

/**
 * Task 22: `agent-sdk.ts` had no replay mechanism at all before this -
 * `query()`'s whole multi-turn loop is SDK-owned, so there's no single
 * dispatch call to wrap the way `dispatchGeminiRaw` is. `recordSession`/
 * `replaySession` are the session-level stand-in: real fixture files
 * under tests/fixtures/agent-sdk/, written and cleaned up by each test
 * (same discipline as the scrape_cache/system_errors leak fixes from
 * Tasks 18/20 - nothing here uses a mock filesystem).
 */
describe("agent-sdk runner: recordSession / replaySession", () => {
  async function* fakeLiveGenerator(messages: unknown[]) {
    for (const message of messages) yield message as never;
  }

  it("recordSession yields every message through and saves them as a fixture", async () => {
    const fixtureKey = `agent-sdk-test:record:${Date.now()}`;
    const filePath = fixturePathFor(fixtureKey);
    try {
      const live = fakeLiveGenerator([
        { type: "system", subtype: "init", skills: ["a"] },
        { type: "result", num_turns: 1, total_cost_usd: 0.01, modelUsage: {} },
      ]);

      const yielded: unknown[] = [];
      for await (const message of recordSession(fixtureKey, live as never)) yielded.push(message);

      expect(yielded).toHaveLength(2);
      expect(existsSync(filePath)).toBe(true);
      const saved = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(saved).toEqual([
        { type: "system", subtype: "init", skills: ["a"] },
        { type: "result", num_turns: 1, total_cost_usd: 0.01, modelUsage: {} },
      ]);
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it("recordSession still saves whatever it captured if the live generator throws mid-session", async () => {
    const fixtureKey = `agent-sdk-test:record-partial:${Date.now()}`;
    const filePath = fixturePathFor(fixtureKey);
    async function* throwingGenerator() {
      yield { type: "system", subtype: "init", skills: [] } as never;
      throw new Error("Reached maximum number of turns (3)");
    }
    try {
      await expect(async () => {
        for await (const _ of recordSession(fixtureKey, throwingGenerator())) {
          /* drain */
        }
      }).rejects.toThrow("Reached maximum number of turns");

      expect(existsSync(filePath)).toBe(true);
      const saved = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(saved).toEqual([{ type: "system", subtype: "init", skills: [] }]);
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it("replaySession yields the recorded messages in order and replays each tool_use through the raw handler", async () => {
    const fixtureKey = `agent-sdk-test:replay:${Date.now()}`;
    saveFixture(fixtureKey, [
      { type: "system", subtype: "init", skills: [] },
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "mcp__lead-agent__save_icp", input: { target_company_type: "B2B SaaS" } }],
        },
      },
      { type: "result", num_turns: 1, total_cost_usd: 0.01, modelUsage: {} },
    ]);
    const filePath = fixturePathFor(fixtureKey);

    try {
      const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
      const rawHandlers = {
        save_icp: async (args: Record<string, unknown>) => {
          calls.push({ name: "save_icp", args });
          return { content: [{ type: "text" as const, text: "ok" }] };
        },
      };

      const yielded: unknown[] = [];
      for await (const message of replaySession(fixtureKey, rawHandlers)) yielded.push(message);

      expect(yielded).toHaveLength(3);
      expect(calls).toEqual([{ name: "save_icp", args: { target_company_type: "B2B SaaS" } }]);
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it("replaySession, via the real raw handlers, actually writes through invoke() the same way a live tool call would", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: null, counters: {}, limits: LIMIT_DEFAULTS });
    const ctxRef = { current: { id: "run-1", icp: null, limits: LIMIT_DEFAULTS, counters: { qualified_count: 0 }, clarificationCount: 0, spentUsd: 0, scraper: "crawl4ai" as const } };
    const state: LoopState = { finalized: false, clarificationRequested: false, cancelled: false };
    const rawHandlers = buildRawToolHandlers(ctxRef, state, client);

    const fixtureKey = `agent-sdk-test:replay-real:${Date.now()}`;
    saveFixture(fixtureKey, [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "mcp__lead-agent__save_icp",
              input: {
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
            },
          ],
        },
      },
    ]);
    const filePath = fixturePathFor(fixtureKey);

    try {
      for await (const _ of replaySession(fixtureKey, rawHandlers)) {
        /* drain */
      }
      expect(ctxRef.current.icp).not.toBeNull();
      expect(tables.tool_calls.some((c) => c.tool_name === "save_icp" && c.status === "ok")).toBe(true);
    } finally {
      rmSync(filePath, { force: true });
    }
  });
});
