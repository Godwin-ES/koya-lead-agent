import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "@core/tools/definitions";
import { invoke, ToolDeniedError, type ToolHandler, type ToolRunState } from "@core/tools/log";
import { MAX_DISCOVER_ATTEMPTS } from "@core/tools/gate";
import { mergeRunCounters } from "@core/db/runs";
import { LIMIT_DEFAULTS } from "@core/domain/limits";
import { hashObjective } from "@core/domain/normalize";
import { createFakeSupabase } from "./support/fake-supabase";

function toolByName(name: string) {
  const def = TOOL_DEFINITIONS.find((d) => d.name === name);
  if (!def) throw new Error(`no tool definition for ${name}`);
  return def;
}

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

describe("TOOL_DEFINITIONS", () => {
  it("defines exactly the eight allowed tools, matching gate.ts's TOOL_NAMES", () => {
    expect(TOOL_DEFINITIONS.map((d) => d.name).sort()).toEqual(
      ["save_icp", "request_clarification", "discover_companies", "scrape_site", "save_lead", "save_outreach", "list_run_state", "finalize_run"].sort(),
    );
  });

  it("save_icp persists the icp onto the run row", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: null, counters: {}, limits: LIMIT_DEFAULTS });
    const run = baseRun({ icp: null });

    const result = await invoke({ supabase: client, run }, "save_icp", { target_company_type: "SaaS" }, toolByName("save_icp").handler);

    expect(result.resultSummary).toMatch(/SaaS/);
    expect(tables.runs[0]!.icp).toEqual({ target_company_type: "SaaS" });
  });

  // Every handler already computed a rich `data` payload - invoke() just
  // never persisted it, only the one-line resultSummary, which is why
  // clicking a timeline row for real detail was never possible. This is
  // the plumbing that made that fixable without inventing new data
  // collection: result.data now reaches tool_calls.result_data.
  it("persists the handler's data payload to tool_calls.result_data, not just the summary", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: null, counters: {}, limits: LIMIT_DEFAULTS });
    const run = baseRun({ icp: null });

    await invoke({ supabase: client, run }, "save_icp", { target_company_type: "SaaS", industries: ["fintech"] }, toolByName("save_icp").handler);

    expect(tables.tool_calls).toHaveLength(1);
    expect(tables.tool_calls[0]!.result_data).toEqual({ target_company_type: "SaaS", industries: ["fintech"] });
  });

  it("discover_companies serves a cached result without a live dispatch", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    const query = "b2b saas ops tools";
    const cacheKey = `apify:${hashObjective(query)}`;
    tables.discovery_cache.push({
      cache_key: cacheKey,
      actor_id: "test-actor",
      input_json: {},
      results: [{ companyName: "Acme", companyDomain: "acme.example" }],
      item_count: 1,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const run = baseRun();
    const result = await invoke({ supabase: client, run }, "discover_companies", { query, requested: 5 }, toolByName("discover_companies").handler);

    expect(result.resultSummary).toMatch(/cached/i);
    expect(tables.cost_ledger).toHaveLength(0);
  });

  // Real bug, found live against production Supabase: bumpToolCallsUsed
  // (invoke()'s own bookkeeping, run for every tool call) used to do a
  // full-column replace of `counters`, built from a snapshot taken
  // *before* the handler ran - so it reliably erased whatever field the
  // handler itself had just written a moment earlier in the very same
  // invoke() call. candidates_seen/scrapes_used were being wiped after
  // almost every real tool call, which is why gate()'s candidate/scrape
  // limits never actually fired despite being individually correct.
  it("does not clobber a counter field the handler itself just wrote, when bumpToolCallsUsed writes right after", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    const run = baseRun();

    // Mimics exactly what discover_companies/scrape_site do: merge one
    // counter field mid-handler, independent of tool_calls_used.
    const handlerThatWritesItsOwnCounter: ToolHandler = async (ctx) => {
      await mergeRunCounters(ctx.supabase, ctx.run.id, { candidates_seen: 15 });
      return { resultSummary: "wrote candidates_seen" };
    };

    await invoke({ supabase: client, run }, "discover_companies", {}, handlerThatWritesItsOwnCounter);

    expect(tables.runs[0]!.counters).toMatchObject({ candidates_seen: 15, tool_calls_used: 1 });
  });

  it("denies a fourth discover_companies call - the hard cap on discovery attempts", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    const query = "b2b saas ops tools";
    const cacheKey = `apify:${hashObjective(query)}`;
    tables.discovery_cache.push({
      cache_key: cacheKey,
      actor_id: "test-actor",
      input_json: {},
      results: [{ companyName: "Acme", companyDomain: "acme.example" }],
      item_count: 1,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    let run = baseRun();
    for (let i = 0; i < MAX_DISCOVER_ATTEMPTS; i++) {
      await invoke({ supabase: client, run }, "discover_companies", { query, requested: 5 }, toolByName("discover_companies").handler);
      const freshCounters = tables.runs[0]!.counters as Record<string, number>;
      run = { ...run, counters: { ...run.counters, ...freshCounters } };
    }

    await expect(
      invoke({ supabase: client, run }, "discover_companies", { query, requested: 5 }, toolByName("discover_companies").handler),
    ).rejects.toThrow(ToolDeniedError);
    expect((tables.runs[0]!.counters as Record<string, number>).discover_calls_used).toBe(MAX_DISCOVER_ATTEMPTS);
  });

  it("scrape_site serves a cached scrape without a live dispatch", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    const url = "https://foo.example/about";
    tables.scrape_cache.push({
      url_hash: hashObjective(url),
      url,
      scraper: "crawl4ai",
      title: "About",
      content_md: "About us",
      http_status: 200,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const run = baseRun();
    const result = await invoke(
      { supabase: client, run },
      "scrape_site",
      { url, candidateDomain: "foo.example" },
      toolByName("scrape_site").handler,
    );

    expect(result.resultSummary).toMatch(/cached/i);
    expect(tables.cost_ledger).toHaveLength(0);
  });

  it("save_lead persists a qualification decision", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    const run = baseRun();

    const result = await invoke(
      { supabase: client, run },
      "save_lead",
      {
        company_name: "Acme Inc",
        company_domain: "https://www.acme.example/",
        qualification_status: "qualified",
        confidence: 0.8,
        fit_reasons: ["B2B SaaS", "10-100 employees"],
        concerns: [],
        source_urls: ["https://acme.example/about"],
        source_summary: "Acme builds ops tooling for logistics teams.",
      },
      toolByName("save_lead").handler,
    );

    expect(result.resultSummary).toMatch(/qualified/i);
    expect(tables.leads[0]!.company_domain).toBe("acme.example");
  });

  it("save_outreach runs the grounding check and stores the flag", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    tables.leads.push({
      id: "lead-1",
      run_id: "run-1",
      company_name: "Acme Inc",
      company_domain: "acme.example",
      source_summary: "Acme builds ops tooling for logistics teams and is hiring operations engineers.",
      source_urls: ["https://acme.example/about"],
    });

    const run = baseRun();
    const result = await invoke(
      { supabase: client, run },
      "save_outreach",
      {
        lead_id: "lead-1",
        channel: "email",
        step: 1,
        subject: "Quick question",
        body: "I noticed Acme Inc is hiring operations engineers to scale your logistics tooling.",
        personalization_note: "References their hiring signal.",
      },
      toolByName("save_outreach").handler,
    );

    expect(tables.outreach_drafts).toHaveLength(1);
    expect(tables.outreach_drafts[0]!.flagged_unsupported).toBe(false);
    expect(result.resultSummary).toMatch(/email step 1/i);
  });

  it("list_run_state reports live counts without writing anything", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", status: "running", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    tables.leads.push({ id: "lead-1", run_id: "run-1", qualification_status: "qualified" });

    const run = baseRun();
    const result = await invoke({ supabase: client, run }, "list_run_state", {}, toolByName("list_run_state").handler);

    expect(result.resultSummary).toMatch(/1 qualified/i);
  });

  it("finalize_run computes a real quality report from saved leads and drafts", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", status: "running", icp: {}, counters: {}, limits: { ...LIMIT_DEFAULTS, target_qualified: 1 } });
    tables.leads.push({
      id: "lead-1",
      run_id: "run-1",
      company_name: "Acme",
      company_domain: "acme.example",
      qualification_status: "qualified",
      fit_reasons: ["fits"],
      concerns: [],
      source_summary: "Acme builds ops tooling.",
      source_urls: ["https://acme.example"],
    });
    tables.outreach_drafts.push({ id: "draft-1", lead_id: "lead-1", flagged_unsupported: false });

    const run = baseRun();
    const result = await invoke({ supabase: client, run }, "finalize_run", { summary: "Found 1 of 1 target." }, toolByName("finalize_run").handler);

    expect(result.resultSummary).toMatch(/completed/i);
    expect(tables.runs[0]!.status).toBe("completed");
  });
});

describe("invoke", () => {
  it("writes a tool_calls row for a denial, not only for a success", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: null, counters: {}, limits: LIMIT_DEFAULTS });
    const run = baseRun({ icp: null });

    await expect(invoke({ supabase: client, run }, "scrape_site", { url: "https://x.com" }, toolByName("scrape_site").handler)).rejects.toThrow(
      ToolDeniedError,
    );

    const rows = tables.tool_calls.filter((r) => r.run_id === "run-1");
    expect(rows.at(-1)).toMatchObject({ status: "denied", denial_reason: expect.any(String) });
  });

  it("writes a tool_calls row for a handler error, and re-throws", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    const run = baseRun();

    await expect(
      invoke({ supabase: client, run }, "save_outreach", { lead_id: "missing-lead", channel: "email", step: 1, body: "x", personalization_note: "x" }, toolByName("save_outreach").handler),
    ).rejects.toThrow(/not found/i);

    const rows = tables.tool_calls.filter((r) => r.run_id === "run-1");
    expect(rows.at(-1)).toMatchObject({ status: "error" });
  });

  it("writes an ok tool_calls row on success", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: null, counters: {}, limits: LIMIT_DEFAULTS });
    const run = baseRun({ icp: null });

    await invoke({ supabase: client, run }, "save_icp", { target_company_type: "SaaS" }, toolByName("save_icp").handler);

    const rows = tables.tool_calls.filter((r) => r.run_id === "run-1");
    expect(rows.at(-1)).toMatchObject({ status: "ok" });
  });

  it("increments counters.tool_calls_used on every outcome, so gate()'s own budget check has something real to read", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    const run = baseRun();

    await invoke({ supabase: client, run }, "list_run_state", {}, toolByName("list_run_state").handler);
    expect(tables.runs[0]!.counters).not.toHaveProperty("tool_calls_used"); // uncounted, per gate.ts's own exemption

    await invoke({ supabase: client, run }, "save_icp", { target_company_type: "SaaS" }, toolByName("save_icp").handler);
    expect((tables.runs[0]!.counters as Record<string, number>).tool_calls_used).toBe(1);

    await expect(
      invoke({ supabase: client, run: { ...run, icp: null } }, "scrape_site", { url: "https://x.com" }, toolByName("scrape_site").handler),
    ).rejects.toThrow(ToolDeniedError);
    expect((tables.runs[0]!.counters as Record<string, number>).tool_calls_used).toBe(2);
  });
});
