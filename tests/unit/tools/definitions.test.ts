import { describe, expect, it } from "vitest";
import { MAX_SUMMARY_CHARS, TOOL_DEFINITIONS, MAX_SCRAPE_PAGES_PER_CANDIDATE, FORCE_FINALIZE } from "@core/tools/definitions";
import { buildActorInput } from "@core/providers/discovery/apify";
import { candidatesPerDiscoverCall, type NormalizedCandidate } from "@core/domain/discovery";
import type { DiscoveryFilters } from "@core/schemas/discovery";
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

const FILTERS: DiscoveryFilters = {
  industries: [{ id: "4", label: "Software Development" }],
  headcount_min: 10,
  headcount_max: 100,
  locations: ["United States"],
};

const SAVE_ICP_INPUT = {
  target_company_type: "SaaS",
  discovery_filters: { linkedin_industries: ["Software Development"], headcount_min: 10, headcount_max: 100, locations: ["United States"] },
};

function company(name: string, domain: string | null, overrides: Partial<NormalizedCandidate> = {}): NormalizedCandidate {
  return {
    linkedinId: `li-${name}`,
    universalName: null,
    linkedinUrl: `https://www.linkedin.com/company/${name.toLowerCase()}/`,
    name,
    website: domain ? `https://${domain}` : null,
    domain,
    tagline: `${name} tagline`,
    description: `${name} builds a scheduling platform for clinics.`,
    industries: [{ id: "4", name: "Software Development" }],
    specialities: [],
    employeeCount: 30,
    employeeCountRange: { start: 11, end: 50 },
    locations: [{ text: "Austin, TX, United States", country: "United States", countryCode: "US", state: "Texas", city: "Austin", headquarter: true }],
    companyType: "Privately Held",
    foundedYear: 2019,
    ...overrides,
  };
}

/** A run row with saved discovery filters, plus a cached discovery result for `keyword` so no live dispatch happens. */
function seedDiscoveryRun(tables: Record<string, Array<Record<string, unknown>>>, candidates: NormalizedCandidate[], keyword = "platform", page = 1) {
  if (!tables.runs.some((r) => r.id === "run-1")) {
    tables.runs.push({ id: "run-1", icp: {}, discovery_filters: FILTERS, counters: {}, limits: LIMIT_DEFAULTS });
  }
  const requested = candidatesPerDiscoverCall(LIMIT_DEFAULTS.target_qualified);
  const input = buildActorInput({ industryIds: ["4"], keyword, locations: FILTERS.locations, companySize: ["1-10", "11-50", "51-200"], page, requested }, requested);
  tables.discovery_cache.push({
    cache_key: `apify:run-1:${hashObjective(JSON.stringify(input))}`,
    actor_id: "harvestapi/linkedin-company-search",
    input_json: input,
    results: { candidates, totalResultCount: 130 },
    item_count: candidates.length,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
}

describe("TOOL_DEFINITIONS", () => {
  it("defines exactly the eight allowed tools, matching gate.ts's TOOL_NAMES", () => {
    expect(TOOL_DEFINITIONS.map((d) => d.name).sort()).toEqual(
      ["save_icp", "request_clarification", "discover_companies", "scrape_site", "save_lead", "save_outreach", "list_run_state", "finalize_run"].sort(),
    );
  });

  it("save_icp stores the ICP and the resolved discovery filters separately", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: null, counters: {}, limits: LIMIT_DEFAULTS });
    const run = baseRun({ icp: null });

    const result = await invoke({ supabase: client, run }, "save_icp", SAVE_ICP_INPUT, toolByName("save_icp").handler);

    expect(result.resultSummary).toMatch(/SaaS/);
    expect(tables.runs[0]!.icp).toEqual({ target_company_type: "SaaS" });
    expect(tables.runs[0]!.discovery_filters).toEqual(FILTERS);
    expect(result.modelOutput).toMatch(/Software Development \(4\)/);
  });

  it("save_icp rejects a label that isn't a real LinkedIn industry, with the closest real ones", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: null, counters: {}, limits: LIMIT_DEFAULTS });
    const input = { ...SAVE_ICP_INPUT, discovery_filters: { ...SAVE_ICP_INPUT.discovery_filters, linkedin_industries: ["SaaS Software"] } };

    await expect(invoke({ supabase: client, run: baseRun({ icp: null }) }, "save_icp", input, toolByName("save_icp").handler)).rejects.toThrow(
      /Not LinkedIn industry labels: "SaaS Software" \(closest real labels: .*Software Development/,
    );
    expect(tables.runs[0]!.icp).toBeNull();
  });

  // Every handler already computed a rich `data` payload - invoke() just
  // never persisted it, only the one-line resultSummary, which is why
  // clicking a timeline row for real detail was never possible.
  it("persists the handler's data payload to tool_calls.result_data, not just the summary", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: null, counters: {}, limits: LIMIT_DEFAULTS });

    await invoke({ supabase: client, run: baseRun({ icp: null }) }, "save_icp", SAVE_ICP_INPUT, toolByName("save_icp").handler);

    expect(tables.tool_calls).toHaveLength(1);
    expect(tables.tool_calls[0]!.result_data).toEqual({ icp: { target_company_type: "SaaS" }, discovery_filters: FILTERS });
  });

  it("discover_companies serves a cached result without a live dispatch or spend", async () => {
    const { client, tables } = createFakeSupabase();
    seedDiscoveryRun(tables, [company("Acme", "acme.example")]);

    const result = await invoke({ supabase: client, run: baseRun() }, "discover_companies", { keyword: "platform" }, toolByName("discover_companies").handler);

    expect(result.resultSummary).toMatch(/cached/i);
    expect(tables.cost_ledger).toHaveLength(0);
    // A cache hit costs nothing, so it doesn't draw on candidate_limit.
    expect(tables.runs[0]!.counters).not.toHaveProperty("candidates_seen");
  });

  // Real bug: both runners only ever sent resultSummary back to the model,
  // so "10 candidates discovered" reached it with no companies attached.
  it("sends the model the kept candidates, inside an untrusted-source boundary", async () => {
    const { client, tables } = createFakeSupabase();
    seedDiscoveryRun(tables, [company("Acme", "acme.example"), company("Widgetly", "widgetly.example")]);

    const result = await invoke({ supabase: client, run: baseRun() }, "discover_companies", { keyword: "platform" }, toolByName("discover_companies").handler);

    expect(result.modelOutput).toMatch(/<untrusted_source url="harvestapi\/linkedin-company-search"/);
    expect(result.modelOutput).toContain("acme.example");
    expect(result.modelOutput).toContain("Widgetly builds a scheduling platform for clinics.");
    expect(result.modelOutput).toMatch(/LinkedIn pool for this search: 130/);
  });

  it("drops candidates that fail the size/location/website prefilter, and says why", async () => {
    const { client, tables } = createFakeSupabase();
    seedDiscoveryRun(tables, [
      company("Keep", "keep.example"),
      company("TooBig", "toobig.example", { employeeCountRange: { start: 201, end: 500 } }),
      company("NoSite", null),
    ]);

    const result = await invoke({ supabase: client, run: baseRun() }, "discover_companies", { keyword: "platform" }, toolByName("discover_companies").handler);
    const data = result.data as { candidates: NormalizedCandidate[]; dropped: NormalizedCandidate[] };

    expect(data.candidates.map((c) => c.name)).toEqual(["Keep"]);
    expect(data.dropped.map((c) => c.name)).toEqual(["TooBig", "NoSite"]);
    expect(result.modelOutput).toMatch(/TooBig \(toobig\.example\): LinkedIn size range 201-500 is outside/);
  });

  it("de-duplicates against every earlier attempt in the run, kept or dropped", async () => {
    const { client, tables } = createFakeSupabase();
    seedDiscoveryRun(tables, [company("Acme", "acme.example"), company("TooBig", "toobig.example", { employeeCountRange: { start: 201, end: 500 } })]);
    seedDiscoveryRun(tables, [company("Acme", "acme.example"), company("TooBig", "toobig.example"), company("New", "new.example")], "platform", 2);

    let run = baseRun();
    await invoke({ supabase: client, run }, "discover_companies", { keyword: "platform" }, toolByName("discover_companies").handler);
    run = { ...run, counters: { ...run.counters, ...(tables.runs[0]!.counters as Record<string, number>) } };
    const second = await invoke({ supabase: client, run }, "discover_companies", { keyword: "platform", page: 2 }, toolByName("discover_companies").handler);
    const data = second.data as { candidates: NormalizedCandidate[]; duplicateCount: number; attempt: number };

    expect(data.candidates.map((c) => c.name)).toEqual(["New"]);
    expect(data.duplicateCount).toBe(2);
    expect(data.attempt).toBe(2);
  });

  it("rejects a criteria-word keyword without using up a discovery attempt", async () => {
    const { client, tables } = createFakeSupabase();
    seedDiscoveryRun(tables, []);

    await expect(
      invoke({ supabase: client, run: baseRun() }, "discover_companies", { keyword: "B2B SaaS Series A companies" }, toolByName("discover_companies").handler),
    ).rejects.toThrow(/at most 3|criteria words/);
    expect(tables.runs[0]!.counters).not.toHaveProperty("discover_calls_used");
  });

  it("refuses to search before save_icp has stored discovery filters", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, discovery_filters: null, counters: {}, limits: LIMIT_DEFAULTS });

    await expect(invoke({ supabase: client, run: baseRun() }, "discover_companies", {}, toolByName("discover_companies").handler)).rejects.toThrow(/discovery_filters/);
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
    seedDiscoveryRun(tables, [company("Acme", "acme.example")]);

    let run = baseRun();
    for (let i = 0; i < MAX_DISCOVER_ATTEMPTS; i++) {
      await invoke({ supabase: client, run }, "discover_companies", { keyword: "platform" }, toolByName("discover_companies").handler);
      const freshCounters = tables.runs[0]!.counters as Record<string, number>;
      run = { ...run, counters: { ...run.counters, ...freshCounters } };
    }

    await expect(
      invoke({ supabase: client, run }, "discover_companies", { keyword: "platform" }, toolByName("discover_companies").handler),
    ).rejects.toThrow(ToolDeniedError);
    expect((tables.runs[0]!.counters as Record<string, number>).discover_calls_used).toBe(MAX_DISCOVER_ATTEMPTS);
  });

  async function discoverOnce(client: ReturnType<typeof createFakeSupabase>["client"], tables: Record<string, Array<Record<string, unknown>>>, candidates: NormalizedCandidate[]) {
    seedDiscoveryRun(tables, candidates);
    await invoke({ supabase: client, run: baseRun() }, "discover_companies", { keyword: "platform" }, toolByName("discover_companies").handler);
  }

  function cachePage(tables: Record<string, Array<Record<string, unknown>>>, url: string, content: string) {
    tables.scrape_cache.push({
      url_hash: hashObjective(url),
      url,
      scraper: "crawl4ai",
      title: "About",
      content_md: content,
      http_status: 200,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
  }

  it("scrape_site serves a cached scrape without a live dispatch, and sends the model the page text", async () => {
    const { client, tables } = createFakeSupabase();
    await discoverOnce(client, tables, [company("Foo", "foo.example")]);
    const url = "https://foo.example/about";
    cachePage(tables, url, "Foo sells per-seat scheduling software to clinics.");

    const result = await invoke({ supabase: client, run: baseRun() }, "scrape_site", { url, candidateDomain: "foo.example" }, toolByName("scrape_site").handler);

    expect(result.resultSummary).toMatch(/cached/i);
    expect(tables.cost_ledger).toHaveLength(0);
    // Real bug: the model used to receive only "Scraped <url>", never the page.
    expect(result.modelOutput).toMatch(/<untrusted_source url="https:\/\/foo\.example\/about" scraper="crawl4ai">\nFoo sells per-seat scheduling software to clinics\.\n<\/untrusted_source>/);
  });

  it("scrape_site refuses a domain that isn't one of the run's kept candidates", async () => {
    const { client, tables } = createFakeSupabase();
    await discoverOnce(client, tables, [company("Foo", "foo.example"), company("TooBig", "toobig.example", { employeeCountRange: { start: 201, end: 500 } })]);

    await expect(
      invoke({ supabase: client, run: baseRun() }, "scrape_site", { url: "https://other.example", candidateDomain: "other.example" }, toolByName("scrape_site").handler),
    ).rejects.toThrow(/not one of this run's kept candidates/);
    await expect(
      invoke({ supabase: client, run: baseRun() }, "scrape_site", { url: "https://toobig.example", candidateDomain: "toobig.example" }, toolByName("scrape_site").handler),
    ).rejects.toThrow(/not one of this run's kept candidates/);
  });

  it(`scrape_site allows at most ${MAX_SCRAPE_PAGES_PER_CANDIDATE} pages per company`, async () => {
    const { client, tables } = createFakeSupabase();
    await discoverOnce(client, tables, [company("Foo", "foo.example")]);
    for (const path of ["", "/pricing", "/about"]) cachePage(tables, `https://foo.example${path}`, `page ${path}`);

    const scrapeFoo = (path: string) =>
      invoke({ supabase: client, run: baseRun() }, "scrape_site", { url: `https://foo.example${path}`, candidateDomain: "www.foo.example" }, toolByName("scrape_site").handler);
    await scrapeFoo("");
    await scrapeFoo("/pricing");
    await expect(scrapeFoo("/about")).rejects.toThrow(/Already scraped 2 pages of foo\.example/);
    // Re-reading a page already scraped (a resumed run's new conversation
    // no longer holds it) doesn't count against the limit.
    await expect(scrapeFoo("/pricing")).resolves.toMatchObject({ resultSummary: expect.stringMatching(/cached/i) });
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

  // Live: the model only ever got "Saved lead X as qualified", invented a
  // UUID for save_outreach, and got "lead ... not found".
  it("save_lead tells the model the saved lead's real id and the running qualified count", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: { ...LIMIT_DEFAULTS, target_qualified: 10 } });

    const result = await invoke(
      { supabase: client, run: baseRun({ limits: { ...LIMIT_DEFAULTS, target_qualified: 10 } }) },
      "save_lead",
      {
        company_name: "Acme Inc",
        company_domain: "acme.example",
        qualification_status: "qualified",
        confidence: 0.8,
        fit_reasons: ["SaaS: per-seat plans"],
        concerns: [],
        source_urls: ["https://acme.example/pricing"],
        source_summary: "Acme sells scheduling software.",
      },
      toolByName("save_lead").handler,
    );

    const leadId = tables.leads[0]!.id as string;
    expect(result.modelOutput).toContain(`lead_id: ${leadId}`);
    expect(result.modelOutput).toMatch(/Qualified so far: 1 of 10/);
    expect(result.modelOutput).toMatch(/Draft its outreach with save_outreach/);
  });

  it("save_outreach refuses a lead id from another run, with how to recover", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    tables.leads.push({ id: "lead-other", run_id: "run-2", company_name: "Other", company_domain: "other.example", source_summary: "x", source_urls: [] });

    await expect(
      invoke(
        { supabase: client, run: baseRun() },
        "save_outreach",
        { lead_id: "lead-other", channel: "email", step: 1, body: "Hi", personalization_note: "x" },
        toolByName("save_outreach").handler,
      ),
    ).rejects.toThrow(/not found in this run - use the exact lead_id that save_lead returned/);
  });

  it("save_lead leaves a reviewer's decision alone, and says so", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    tables.leads.push({ id: "lead-1", run_id: "run-1", company_name: "Acme", company_domain: "acme.example", qualification_status: "qualified", decided_by: "reviewer", review_reason: "Confirmed by phone" });

    await expect(
      invoke(
        { supabase: client, run: baseRun() },
        "save_lead",
        { company_name: "Acme", company_domain: "acme.example", qualification_status: "not_qualified", confidence: 0.5, fit_reasons: [], concerns: ["x"], source_urls: [], source_summary: "x" },
        toolByName("save_lead").handler,
      ),
    ).rejects.toThrow(/already decided by the reviewer \(qualified\): "Confirmed by phone"/);
    expect(tables.leads[0]!.qualification_status).toBe("qualified");
  });

  it("save_lead records the agent's own decision alongside the status", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });

    await invoke(
      { supabase: client, run: baseRun() },
      "save_lead",
      { company_name: "Acme", company_domain: "acme.example", qualification_status: "needs_review", confidence: 0.5, fit_reasons: [], concerns: ["size unclear"], source_urls: ["https://acme.example"], source_summary: "x" },
      toolByName("save_lead").handler,
    );
    expect(tables.leads[0]).toMatchObject({ qualification_status: "needs_review", agent_qualification_status: "needs_review" });
  });

  it("save_lead attaches the LinkedIn discovery data and the prefilter's own concerns automatically", async () => {
    const { client, tables } = createFakeSupabase();
    await discoverOnce(client, tables, [company("Acme", "acme.example", { employeeCount: 504, employeeCountRange: { start: 51, end: 200 } })]);

    await invoke(
      { supabase: client, run: baseRun() },
      "save_lead",
      {
        company_name: "Acme",
        company_domain: "acme.example",
        qualification_status: "qualified",
        confidence: 0.8,
        fit_reasons: ["SaaS: pricing page lists per-seat plans (acme.example/pricing)"],
        concerns: [],
        source_urls: ["https://acme.example/pricing"],
        source_summary: "Acme sells scheduling software to clinics.",
      },
      toolByName("save_lead").handler,
    );

    const lead = tables.leads[0]!;
    expect((lead.discovery_payload as { linkedinUrl: string }).linkedinUrl).toBe("https://www.linkedin.com/company/acme/");
    expect(lead.concerns).toEqual([expect.stringMatching(/504 linked members against a self-reported 51-200/)]);
  });

  /** A qualified NextStage lead, its scraped homepage, and the signed-in user "Jordan Reyes". */
  function seedOutreachLead(tables: Record<string, Array<Record<string, unknown>>>) {
    tables.runs.push({ id: "run-1", user_id: "user-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    tables.auth_users.push({ id: "user-1", user_metadata: { display_name: "Jordan Reyes" } });
    tables.leads.push({
      id: "lead-1",
      run_id: "run-1",
      company_name: "NextStage",
      company_domain: "nextstage.ai",
      qualification_status: "qualified",
      fit_reasons: ["B2B: built for government contractors (nextstage.ai)"],
      source_summary: "AI-enabled growth platform for government contractors.",
      source_urls: ["https://nextstage.ai"],
    });
    tables.scrape_cache.push({
      url: "https://nextstage.ai",
      url_hash: hashObjective("https://nextstage.ai"),
      scraper: "crawl4ai",
      content_md: "NextStage gives government contractors federal procurement data, pipeline tracking and an AI-Powered Proposal Suite with an AI compliance matrix.",
      http_status: 200,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
  }

  const GOOD_EMAIL_1 = [
    "NextStage gives government contractors federal procurement data, pipeline tracking and AI-assisted proposals in one place, which puts your team close to a lot of document-heavy work.",
    "At Koya Talent we place trained AI automation assistants inside teams to take on repetitive work like that - preparing first-pass compliance matrices, or keeping pipeline data tidy.",
    "Is that kind of support something your team has considered?",
  ].join("\n\n");

  const saveOutreach = (client: ReturnType<typeof createFakeSupabase>["client"], input: Record<string, unknown>) =>
    invoke({ supabase: client, run: baseRun() }, "save_outreach", { lead_id: "lead-1", channel: "email", step: 1, personalization_evidence: "AI-Powered Proposal Suite with compliance matrix (nextstage.ai)", ...input }, toolByName("save_outreach").handler);

  it("save_outreach wraps the content with the greeting and the sender's own signature", async () => {
    const { client, tables } = createFakeSupabase();
    seedOutreachLead(tables);

    const result = await saveOutreach(client, { subject: "proposal prep at NextStage", body: GOOD_EMAIL_1 });

    const draft = tables.outreach_drafts[0]!;
    expect(draft.body).toBe(`Good day,\n\n${GOOD_EMAIL_1}\n\nBest,\nJordan Reyes\nKoya Talent`);
    // Subjects are saved in Title Case.
    expect(draft.subject).toBe("Proposal Prep at NextStage");
    // Stored for the grounding check and traceability - never part of the message.
    expect(draft.personalization_note).toBe("AI-Powered Proposal Suite with compliance matrix (nextstage.ai)");
    expect(draft.flagged_unsupported).toBe(false);
    expect(result.modelOutput).toBe("Saved email step 1 for NextStage.");
  });

  it("save_outreach signs as the company when the sender has no display name, never with a placeholder", async () => {
    const { client, tables } = createFakeSupabase();
    seedOutreachLead(tables);
    tables.auth_users.length = 0;

    await saveOutreach(client, { subject: "proposal prep at NextStage", body: GOOD_EMAIL_1 });

    expect(tables.outreach_drafts[0]!.body).toMatch(/Best,\nThe Koya Talent team$/);
  });

  // Live: emails 2 and 3 were sent with no subject, the database rejected
  // them, and the model only ever saw "[object Object]".
  it("save_outreach rejects an email without a subject, saying why, and saves nothing", async () => {
    const { client, tables } = createFakeSupabase();
    seedOutreachLead(tables);

    await expect(saveOutreach(client, { step: 2, subject: null, body: GOOD_EMAIL_1 })).rejects.toThrow(/Email step 2 needs its own subject line/);
    expect(tables.outreach_drafts).toHaveLength(0);
  });

  // The live mindzie email 1, as the model wrote it.
  it("save_outreach rejects placeholders, its own greeting and sign-off, stock phrases, and a missing introduction", async () => {
    const { client, tables } = createFakeSupabase();
    seedOutreachLead(tables);
    const live = "Hi [Name],\n\nI noticed NextStage's platform approach and how you help companies navigate their transformation initiatives. Many B2B SaaS companies we talk to are looking to scale automated workflows without adding headcount.\n\nAre you currently exploring ways to accelerate NextStage's AI automation features?\n\nBest,\n[Your Name]";

    const error = await saveOutreach(client, { subject: "Accelerating NextStage's AI features", body: live }).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/^NextStage email step 1 sent back to fix:/);
    expect(message).toMatch(/Don't write a greeting/);
    expect(message).toMatch(/Don't write a sign-off/);
    expect(message).toMatch(/placeholder \(\[Name\]\)/);
    expect(message).toMatch(/"we talk to"/);
    expect(message).toMatch(/introduce Koya Talent/);
    expect(tables.outreach_drafts).toHaveLength(0);
    // Intended guardrail behavior, recorded apart from real errors.
    expect(tables.tool_calls.at(-1)).toMatchObject({ status: "sent_back", result_summary: "NextStage email step 1 sent back to fix" });
    expect((tables.tool_calls.at(-1)!.result_data as { reasons: string[] }).reasons.length).toBeGreaterThanOrEqual(5);
  });

  // Live: "Refer to Everflow - Partner Marketing Platform by name" - the check demanded the LinkedIn tagline.
  it("save_outreach checks for the company's own name, not its LinkedIn display name", async () => {
    const { client, tables } = createFakeSupabase();
    seedOutreachLead(tables);
    tables.leads[0]!.company_name = "NextStage - GovCon Growth Platform";

    const result = await saveOutreach(client, { subject: "proposal prep at NextStage", body: GOOD_EMAIL_1 });

    expect(result.resultSummary).toBe("Saved NextStage email step 1");
  });

  it("save_outreach checks claims against the scraped pages, and asks for a rewrite when one can't be traced", async () => {
    const { client, tables } = createFakeSupabase();
    seedOutreachLead(tables);
    const invented = GOOD_EMAIL_1.replace("Is that kind", "NextStage raised a Series B from Andreessen Horowitz last spring. Is that kind");

    const result = await saveOutreach(client, { subject: "proposal prep at NextStage", body: invented });

    expect(tables.outreach_drafts[0]!.flagged_unsupported).toBe(true);
    expect(result.modelOutput).toMatch(/couldn't be traced.*Series B from Andreessen Horowitz/);
    expect(result.modelOutput).toMatch(/rewrite the draft without it and save the same step again/);
  });

  it("save_outreach never overwrites a draft the reviewer edited", async () => {
    const { client, tables } = createFakeSupabase();
    seedOutreachLead(tables);
    tables.outreach_drafts.push({ id: "d1", lead_id: "lead-1", channel: "email", step: 1, body: "Reviewer's text", edited_at: new Date().toISOString() });

    await expect(saveOutreach(client, { subject: "proposal prep at NextStage", body: GOOD_EMAIL_1 })).rejects.toThrow(/reviewer has edited this email step 1/);
    expect(tables.outreach_drafts[0]!.body).toBe("Reviewer's text");
  });

  it("an agent rewrite of a draft clears its approval", async () => {
    const { client, tables } = createFakeSupabase();
    seedOutreachLead(tables);
    tables.outreach_drafts.push({ id: "d1", lead_id: "lead-1", channel: "email", step: 1, subject: "old", body: "old", approved_at: new Date().toISOString(), edited_at: null });

    await saveOutreach(client, { subject: "proposal prep at NextStage", body: GOOD_EMAIL_1 });

    expect(tables.outreach_drafts[0]!.approved_at).toBeNull();
  });

  it("save_outreach refuses a lead that isn't qualified", async () => {
    const { client, tables } = createFakeSupabase();
    seedOutreachLead(tables);
    tables.leads[0]!.qualification_status = "needs_review";

    await expect(saveOutreach(client, { subject: "proposal prep at NextStage", body: GOOD_EMAIL_1 })).rejects.toThrow(/needs_review - outreach is only drafted for qualified leads/);
  });

  it("list_run_state reports live counts without writing anything", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", status: "running", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    tables.leads.push({ id: "lead-1", run_id: "run-1", qualification_status: "qualified" });

    const run = baseRun();
    const result = await invoke({ supabase: client, run }, "list_run_state", {}, toolByName("list_run_state").handler);

    expect(result.resultSummary).toMatch(/1 qualified/i);
  });

  function seedFinalizeRun(tables: Record<string, Array<Record<string, unknown>>>, counters: Record<string, number> = {}) {
    tables.runs.push({ id: "run-1", status: "running", icp: {}, discovery_filters: FILTERS, counters, limits: { ...LIMIT_DEFAULTS, target_qualified: 2 } });
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
  }
  const fullOutreach = (leadId: string) => [
    { id: `${leadId}-e1`, lead_id: leadId, channel: "email", step: 1, flagged_unsupported: false },
    { id: `${leadId}-e2`, lead_id: leadId, channel: "email", step: 2, flagged_unsupported: false },
    { id: `${leadId}-e3`, lead_id: leadId, channel: "email", step: 3, flagged_unsupported: false },
    { id: `${leadId}-li`, lead_id: leadId, channel: "linkedin", step: 1, flagged_unsupported: false },
  ];
  const finalize = (client: ReturnType<typeof createFakeSupabase>["client"], counters: Record<string, number> = {}, extra: Record<string, unknown> = {}) =>
    invoke({ supabase: client, run: baseRun({ counters: { qualified_count: 0, ...counters }, limits: { ...LIMIT_DEFAULTS, target_qualified: 2 } }) }, "finalize_run", { summary: "done", ...extra }, toolByName("finalize_run").handler);

  it("finalize_run computes a real quality report once nothing useful is left to do", async () => {
    const { client, tables } = createFakeSupabase();
    const exhausted = { discover_calls_used: MAX_DISCOVER_ATTEMPTS };
    seedFinalizeRun(tables, exhausted);
    tables.outreach_drafts.push(...fullOutreach("lead-1"));

    const result = await finalize(client, exhausted);

    expect(result.resultSummary).toMatch(/partial/i);
    expect(tables.runs[0]!.status).toBe("partial");
  });

  // Live: a ~2,100-character summary restating the ICP, every search and a safety statement.
  it("finalize_run sends back a summary that's longer than a summary should be", async () => {
    const { client, tables } = createFakeSupabase();
    const exhausted = { discover_calls_used: MAX_DISCOVER_ATTEMPTS };
    seedFinalizeRun(tables, exhausted);
    tables.outreach_drafts.push(...fullOutreach("lead-1"));

    await expect(finalize(client, exhausted, { summary: "x".repeat(MAX_SUMMARY_CHARS + 1) })).rejects.toThrow(/keep it under 900/);
    expect(tables.runs[0]!.status).not.toBe("partial");
    await expect(finalize(client, exhausted, { summary: "1 of 2 qualified.\n- Acme - billing SaaS" })).resolves.toMatchObject({ resultSummary: expect.stringMatching(/partial/i) });
  });

  it("finalize_run is refused while a qualified lead's outreach is incomplete", async () => {
    const { client, tables } = createFakeSupabase();
    seedFinalizeRun(tables, { discover_calls_used: MAX_DISCOVER_ATTEMPTS });
    tables.outreach_drafts.push(fullOutreach("lead-1")[0]!, fullOutreach("lead-1")[3]!);

    await expect(finalize(client, { discover_calls_used: MAX_DISCOVER_ATTEMPTS })).rejects.toThrow(/outreach is incomplete for Acme \(missing email 2, email 3\)/);
    expect(tables.runs[0]!.status).toBe("running");
  });

  // Live: a resumed run finalized at 5 of 10 with 32 kept candidates never scraped.
  it("finalize_run is refused below target while kept candidates are unevaluated, then while searches remain", async () => {
    const { client, tables } = createFakeSupabase();
    seedFinalizeRun(tables, { discover_calls_used: 1 });
    tables.outreach_drafts.push(...fullOutreach("lead-1"));
    seedDiscoveryRun(tables, [company("Acme", "acme.example"), company("Waiting", "waiting.example")]);
    await invoke({ supabase: client, run: baseRun() }, "discover_companies", { keyword: "platform" }, toolByName("discover_companies").handler);

    await expect(finalize(client, { discover_calls_used: 1 })).rejects.toThrow(/1 of 2 qualified, and 1 kept candidates haven't been evaluated yet: waiting\.example/);

    tables.leads.push({ id: "lead-2", run_id: "run-1", company_name: "Waiting", company_domain: "waiting.example", qualification_status: "not_qualified" });
    await expect(finalize(client, { discover_calls_used: 1 })).rejects.toThrow(/2 discovery attempts remain\. Search again/);
  });

  it("finalize_run's turn-limit call from the runner itself is never refused", async () => {
    const { client, tables } = createFakeSupabase();
    seedFinalizeRun(tables);

    const result = await finalize(client, {}, { [FORCE_FINALIZE]: true });

    expect(result.resultSummary).toMatch(/Run finalized/);
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

  it("writes an error row for a real failure, and re-throws", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    const failing: ToolHandler = async () => {
      throw { message: "connection terminated", code: "08006" };
    };

    await expect(invoke({ supabase: client, run: baseRun() }, "save_outreach", {}, failing)).rejects.toMatchObject({ message: "connection terminated" });

    // The database's own message, not "[object Object]".
    expect(tables.tool_calls.at(-1)).toMatchObject({ status: "error", error_message: "connection terminated (08006)" });
  });

  it("records a guardrail sending a call back as sent_back, not error", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });

    await expect(
      invoke({ supabase: client, run: baseRun() }, "save_outreach", { lead_id: "missing-lead", channel: "email", step: 1, body: "x", personalization_evidence: "x" }, toolByName("save_outreach").handler),
    ).rejects.toThrow(/use the exact lead_id that save_lead returned/);

    expect(tables.tool_calls.at(-1)).toMatchObject({ status: "sent_back", result_summary: "Draft sent back", error_message: null });
  });

  it("writes an ok tool_calls row on success", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: null, counters: {}, limits: LIMIT_DEFAULTS });
    const run = baseRun({ icp: null });

    await invoke({ supabase: client, run }, "save_icp", SAVE_ICP_INPUT, toolByName("save_icp").handler);

    const rows = tables.tool_calls.filter((r) => r.run_id === "run-1");
    expect(rows.at(-1)).toMatchObject({ status: "ok" });
  });

  it("increments counters.tool_calls_used on every outcome, so gate()'s own budget check has something real to read", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", icp: {}, counters: {}, limits: LIMIT_DEFAULTS });
    const run = baseRun();

    await invoke({ supabase: client, run }, "list_run_state", {}, toolByName("list_run_state").handler);
    expect(tables.runs[0]!.counters).not.toHaveProperty("tool_calls_used"); // uncounted, per gate.ts's own exemption

    await invoke({ supabase: client, run }, "save_icp", SAVE_ICP_INPUT, toolByName("save_icp").handler);
    expect((tables.runs[0]!.counters as Record<string, number>).tool_calls_used).toBe(1);

    await expect(
      invoke({ supabase: client, run: { ...run, icp: null } }, "scrape_site", { url: "https://x.com" }, toolByName("scrape_site").handler),
    ).rejects.toThrow(ToolDeniedError);
    expect((tables.runs[0]!.counters as Record<string, number>).tool_calls_used).toBe(2);
  });
});
