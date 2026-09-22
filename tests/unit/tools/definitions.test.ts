import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "@core/tools/definitions";
import { invoke, ToolDeniedError, type ToolRunState } from "@core/tools/log";
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
});
