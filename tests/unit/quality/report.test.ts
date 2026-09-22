import { describe, expect, it } from "vitest";
import { computeQualityReport } from "@core/quality/report";
import { buildSamplePackMarkdown } from "@core/quality/sample-pack";
import type { LeadRow, OutreachDraftRow } from "@core/db/row-types";

function lead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: overrides.id ?? `lead-${Math.random()}`,
    run_id: "run-1",
    company_name: "Acme Inc",
    company_domain: "acme.example",
    qualification_status: "qualified",
    confidence: 0.8,
    fit_reasons: ["B2B SaaS"],
    concerns: [],
    source_urls: ["https://acme.example/about"],
    source_summary: "Acme builds ops tooling for logistics teams.",
    discovery_payload: null,
    scraper_used: "crawl4ai",
    injection_flagged: false,
    evidence_gap_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function draft(leadId: string, overrides: Partial<OutreachDraftRow> = {}): OutreachDraftRow {
  return {
    id: `draft-${Math.random()}`,
    lead_id: leadId,
    channel: "email",
    step: 1,
    subject: "Quick question",
    body: "Hello",
    personalization_note: "note",
    grounding_check: { flagged: false, unsupportedClaims: [] },
    flagged_unsupported: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function draftsMap(entries: Array<[string, OutreachDraftRow[]]>): Map<string, OutreachDraftRow[]> {
  return new Map(entries);
}

function checkById(report: ReturnType<typeof computeQualityReport>, id: string) {
  return report.checks.find((c) => c.id === id)!;
}

describe("computeQualityReport", () => {
  it("fails the duplicate check when two leads share a normalized domain", () => {
    const a = lead({ id: "a", company_domain: "acme.example" });
    const b = lead({ id: "b", company_domain: "acme.example" });
    const report = computeQualityReport({
      leads: [a, b],
      draftsByLeadId: draftsMap([]),
      targetQualified: 1,
      emailFindingOrSendAttempted: false,
      summary: "test",
    });

    expect(checkById(report, "no_duplicate_companies").passed).toBe(false);
    expect(checkById(report, "no_duplicate_companies").detail).toContain("acme.example");
  });

  it("does not count needs_review leads as qualified", () => {
    const qualified = lead({ id: "a", qualification_status: "qualified" });
    const review = lead({ id: "b", qualification_status: "needs_review", fit_reasons: [], concerns: ["Missing evidence"] });
    const report = computeQualityReport({
      leads: [qualified, review],
      draftsByLeadId: draftsMap([["a", [draft("a")]]]),
      targetQualified: 1,
      emailFindingOrSendAttempted: false,
      summary: "test",
    });

    expect(checkById(report, "has_ten_qualified").detail).toMatch(/1 of 1/);
    expect(checkById(report, "needs_review_excluded_from_qualified_count").passed).toBe(true);
  });

  it("fails data completeness when a qualified lead lacks a source summary", () => {
    const noSummary = lead({ id: "a", source_summary: null });
    const report = computeQualityReport({
      leads: [noSummary],
      draftsByLeadId: draftsMap([["a", [draft("a")]]]),
      targetQualified: 1,
      emailFindingOrSendAttempted: false,
      summary: "test",
    });

    expect(checkById(report, "every_lead_has_source_context").passed).toBe(false);
    expect(report.scorecard.find((s) => s.dimension === "data_completeness")!.passed).toBe(false);
  });

  it("passes the safety check only when no email finding or send tool was ever called", () => {
    const clean = computeQualityReport({
      leads: [lead({ id: "a" })],
      draftsByLeadId: draftsMap([["a", [draft("a")]]]),
      targetQualified: 1,
      emailFindingOrSendAttempted: false,
      summary: "test",
    });
    expect(checkById(clean, "no_email_finding_or_validation_attempted").passed).toBe(true);
    expect(clean.scorecard.find((s) => s.dimension === "safety_compliance")!.passed).toBe(true);

    const violated = computeQualityReport({
      leads: [lead({ id: "a" })],
      draftsByLeadId: draftsMap([["a", [draft("a")]]]),
      targetQualified: 1,
      emailFindingOrSendAttempted: true,
      summary: "test",
    });
    expect(checkById(violated, "no_email_finding_or_validation_attempted").passed).toBe(false);
    expect(violated.passed).toBe(false);
  });

  it("fails every_qualified_lead_has_outreach_drafts when a qualified lead has no draft", () => {
    const report = computeQualityReport({
      leads: [lead({ id: "a" })],
      draftsByLeadId: draftsMap([]),
      targetQualified: 1,
      emailFindingOrSendAttempted: false,
      summary: "test",
    });
    expect(checkById(report, "every_qualified_lead_has_outreach_drafts").passed).toBe(false);
  });

  it("passes overall only when every check and every scorecard dimension passes", () => {
    const report = computeQualityReport({
      leads: [lead({ id: "a" })],
      draftsByLeadId: draftsMap([["a", [draft("a")]]]),
      targetQualified: 1,
      emailFindingOrSendAttempted: false,
      summary: "Found 1 of 1 target.",
    });
    expect(report.passed).toBe(true);
    expect(report.checks.every((c) => c.passed)).toBe(true);
    expect(report.scorecard.every((s) => s.passed)).toBe(true);
  });
});

describe("buildSamplePackMarkdown", () => {
  it("renders a sample pack containing objective, sources, reasoning, and three emails per lead", () => {
    const qualifiedLead = lead({
      id: "a",
      company_name: "Acme Robotics",
      fit_reasons: ["B2B SaaS", "10-100 employees"],
      source_urls: ["https://acme.example/about", "https://acme.example/careers"],
    });
    const drafts = [
      draft("a", { channel: "email", step: 1, subject: "Quick question", body: "Step one body." }),
      draft("a", { channel: "email", step: 2, subject: "Following up", body: "Step two body." }),
      draft("a", { channel: "email", step: 3, subject: "Last note", body: "Step three body." }),
      draft("a", { channel: "linkedin", step: 1, subject: null, body: "LinkedIn body." }),
    ];

    const markdown = buildSamplePackMarkdown({
      objective: "Find 10 US B2B SaaS companies, 10-100 employees",
      qualifiedLeads: [qualifiedLead],
      draftsByLeadId: draftsMap([["a", drafts]]),
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(markdown).toContain("Find 10 US B2B SaaS companies, 10-100 employees");
    expect(markdown).toContain("https://acme.example/about");
    expect(markdown).toContain("https://acme.example/careers");
    expect(markdown).toContain("B2B SaaS");
    expect(markdown).toContain("### Email 1: Quick question");
    expect(markdown).toContain("### Email 2: Following up");
    expect(markdown).toContain("### Email 3: Last note");
    expect(markdown).toContain("### LinkedIn message");
    expect(markdown).toContain("Step one body.");
    expect(markdown).toContain("LinkedIn body.");
  });

  it("excludes leads that are not qualified - only qualifiedLeads passed in are rendered", () => {
    const markdown = buildSamplePackMarkdown({
      objective: "test objective",
      qualifiedLeads: [],
      draftsByLeadId: draftsMap([]),
    });

    expect(markdown).toContain("**Qualified leads:** 0");
    expect(markdown).not.toContain("## ");
  });
});
