import { describe, expect, it } from "vitest";
import { gate, type GateRunState } from "@core/tools/gate";
import { LIMIT_DEFAULTS } from "@core/domain/limits";

function baseRun(overrides: Partial<GateRunState> = {}): GateRunState {
  return {
    icp: { target_company_type: "SaaS" },
    limits: LIMIT_DEFAULTS,
    counters: { qualified_count: 0 },
    clarificationCount: 0,
    spentUsd: 0,
    ...overrides,
  };
}

describe("gate", () => {
  it("denies discovery before the icp has been saved", () => {
    const run = baseRun({ icp: null });
    expect(gate(run, "discover_companies", {}).kind).toBe("deny");
  });

  it("allows save_icp before the icp has been saved", () => {
    const run = baseRun({ icp: null });
    expect(gate(run, "save_icp", {}).kind).toBe("allow");
  });

  it("allows list_run_state before the icp has been saved", () => {
    const run = baseRun({ icp: null });
    expect(gate(run, "list_run_state", {}).kind).toBe("allow");
  });

  it("denies a scrape once the scrape budget is exhausted", () => {
    const run = baseRun({ counters: { qualified_count: 0, scrapes_used: LIMIT_DEFAULTS.scrape_limit } });
    const d = gate(run, "scrape_site", { url: "https://x.com" });
    expect(d.kind).toBe("deny");
    if (d.kind === "deny") expect(d.agentMessage).toMatch(/scrape budget/i);
  });

  it("denies any tool outside the allowlist", () => {
    const run = baseRun();
    expect(gate(run, "Bash", {}).kind).toBe("deny");
    expect(gate(run, "WebFetch", {}).kind).toBe("deny");
  });

  it("denies a second clarification request", () => {
    const run = baseRun({ clarificationCount: 1 });
    expect(gate(run, "request_clarification", { question: "which region?" }).kind).toBe("deny");
  });

  it("allows the first clarification request", () => {
    const run = baseRun({ clarificationCount: 0 });
    expect(gate(run, "request_clarification", { question: "which region?" }).kind).toBe("allow");
  });

  // Dollar-denominated gating was removed deliberately after a real run
  // showed it firing on an inflated cost estimate rather than a real
  // problem (the user's own call: "I don't want to use dollar spend as a
  // limit anywhere"). Real spend is now bounded structurally instead -
  // candidate_limit matched to a single Apify dispatch's own cap, and
  // scrape_site is free (crawl4ai).
  it("never denies for spend, regardless of how high spentUsd is", () => {
    const run = baseRun({ spentUsd: 1_000_000 });
    expect(gate(run, "scrape_site", { url: "https://x.com" }).kind).toBe("allow");
    expect(gate(run, "discover_companies", { query: "saas" }).kind).toBe("allow");
  });

  it("denies once the tool call limit is reached", () => {
    const run = baseRun({ counters: { qualified_count: 0, tool_calls_used: LIMIT_DEFAULTS.max_tool_calls } });
    expect(gate(run, "save_lead", {}).kind).toBe("deny");
  });

  it("never charges list_run_state against the tool call limit", () => {
    const run = baseRun({ counters: { qualified_count: 0, tool_calls_used: LIMIT_DEFAULTS.max_tool_calls } });
    expect(gate(run, "list_run_state", {}).kind).toBe("allow");
  });

  it("denies discovery once the candidate limit is reached", () => {
    const run = baseRun({ counters: { qualified_count: 0, candidates_seen: LIMIT_DEFAULTS.candidate_limit } });
    expect(gate(run, "discover_companies", { query: "saas" }).kind).toBe("deny");
  });

  // A runner's own turn-limit safety valve calls finalize_run directly
  // (worker/src/runners/gemini.ts, agent-sdk.ts) to close a run out
  // gracefully once max_turns is hit. If that call could itself be
  // denied, a run that also happened to exhaust its tool-call or spend
  // budget first would end up uncaught-error'd into `failed` instead of
  // `completed`/`partial` - exactly the ICP-exemption comment's own
  // reasoning ("must be able to close out a run even if...") extended to
  // these two checks, which finalize_run was missing before this fix.
  it("never denies finalize_run for the tool call limit", () => {
    const run = baseRun({ counters: { qualified_count: 0, tool_calls_used: LIMIT_DEFAULTS.max_tool_calls } });
    expect(gate(run, "finalize_run", { summary: "done" }).kind).toBe("allow");
  });

  it("never denies finalize_run for the spend ceiling", () => {
    const run = baseRun({ spentUsd: LIMIT_DEFAULTS.max_spend_usd });
    expect(gate(run, "finalize_run", { summary: "done" }).kind).toBe("allow");
  });

  it("returns an actionable message on denial so the agent can degrade gracefully", () => {
    const run = baseRun({ counters: { qualified_count: 0, scrapes_used: LIMIT_DEFAULTS.scrape_limit } });
    const d = gate(run, "scrape_site", {});
    if (d.kind === "deny") expect(d.agentMessage).toMatch(/qualify from the evidence you already have/i);
  });

  it("allows a well-formed call under budget", () => {
    const run = baseRun();
    const d = gate(run, "discover_companies", { query: "saas" });
    expect(d.kind).toBe("allow");
  });
});
