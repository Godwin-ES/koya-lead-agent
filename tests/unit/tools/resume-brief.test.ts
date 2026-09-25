import { describe, expect, it } from "vitest";
import { buildResumeBrief } from "@core/tools/resume-brief";
import { LIMIT_DEFAULTS } from "@core/domain/limits";
import { createFakeSupabase } from "./support/fake-supabase";

type Tables = ReturnType<typeof createFakeSupabase>["tables"];

const verdict = { status: "pass", reason: "ok" };
function candidate(name: string, domain: string, prefilter: Record<string, unknown> = { size: verdict, location: verdict, concerns: [], dropReason: null, status: "pass" }) {
  return { name, domain, tagline: `${name} tagline`, employeeCountRange: { start: 11, end: 50 }, linkedinId: `li-${name}`, prefilter, locations: [], industries: [] };
}

function seed(tables: Tables) {
  tables.runs.push({
    id: "run-1",
    status: "running",
    icp: { target_company_type: "B2B SaaS" },
    discovery_filters: { industries: [{ id: "4", label: "Software Development" }], headcount_min: 10, headcount_max: 100, locations: ["United States"] },
    counters: { discover_calls_used: 2, scrapes_used: 3 },
    limits: { ...LIMIT_DEFAULTS, target_qualified: 10 },
  });
  tables.tool_calls.push(
    {
      run_id: "run-1",
      tool_name: "discover_companies",
      status: "ok",
      seq: 1,
      result_data: {
        search: { keyword: "platform", industries: [], locations: [], companySize: [], page: 2 },
        attempt: 2,
        totalResultCount: 472,
        itemCount: 4,
        candidates: [
          candidate("Mindzie", "mindzie.com"),
          candidate("Halfway", "halfway.example"),
          candidate("Waiting", "waiting.example"),
          candidate("Edge", "edge.example", { size: { status: "needs_review", reason: "LinkedIn size range 2-10 only touches the required 10-100 at 10." }, location: verdict, concerns: [], dropReason: null, status: "needs_review" }),
        ],
        dropped: [],
        duplicateCount: 0,
        cacheHit: false,
      },
    },
    { run_id: "run-1", tool_name: "scrape_site", status: "ok", seq: 2, result_data: { candidateDomain: "mindzie.com", url: "https://www.mindzie.com" } },
    { run_id: "run-1", tool_name: "scrape_site", status: "ok", seq: 3, result_data: { candidateDomain: "halfway.example", url: "https://halfway.example" } },
  );
  tables.leads.push({ id: "lead-mindzie", run_id: "run-1", company_name: "mindzie, inc.", company_domain: "mindzie.com", qualification_status: "qualified" });
  tables.outreach_drafts.push({ id: "d1", lead_id: "lead-mindzie", channel: "email", step: 1 });
}

describe("buildResumeBrief", () => {
  it("is null for a run with no earlier work - a fresh start needs no note", async () => {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", counters: {}, limits: LIMIT_DEFAULTS });
    expect(await buildResumeBrief(client, "run-1")).toBeNull();
  });

  it("hands over saved leads with their real ids and missing outreach, and the candidates left to work through", async () => {
    const { client, tables } = createFakeSupabase();
    seed(tables);

    const brief = (await buildResumeBrief(client, "run-1"))!;

    expect(brief).toMatch(/^RESUMING THIS RUN/);
    expect(brief).toMatch(/ICP: already saved \(B2B SaaS\).*Don't call save_icp again/);
    expect(brief).toMatch(/Discovery: 2 of 3 attempts used\. Last search: keyword "platform", page 2, pool 472\./);
    // The id the model previously had to invent:
    expect(brief).toContain("- mindzie, inc. (mindzie.com): qualified, lead_id lead-mindzie - outreach still needed: email 2, email 3, LinkedIn");
    // Scraped but undecided: its page isn't in the new conversation, and re-reading it is free.
    expect(brief).toMatch(/Scraped but not yet saved as a lead.*halfway\.example \(https:\/\/halfway\.example\)/);
    // Kept but never scraped - de-duplication hides these from new searches.
    expect(brief).toMatch(/Kept by discovery but not scraped yet \(2\)/);
    expect(brief).toContain("- Waiting (waiting.example): Waiting tagline; 11-50");
    expect(brief).toContain("needs review: LinkedIn size range 2-10 only touches the required 10-100 at 10.");
    expect(brief).not.toMatch(/Kept by discovery[\s\S]*Mindzie \(mindzie\.com\)/);
  });
});
