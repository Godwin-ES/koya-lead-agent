import { describe, expect, it } from "vitest";
import { scoreQualification, scoreGrounding, scoreInjectionBehavior } from "@core/benchmark/score";
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
    agent_qualification_status: null,
    decided_by: "agent",
    review_reason: null,
    reviewed_at: null,
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
    grounding_check: null,
    flagged_unsupported: false,
    original_subject: null,
    original_body: null,
    edited_at: null,
    approved_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("scoreQualification", () => {
  it("scores 100% accuracy when every labeled domain matches", () => {
    const leads = [lead({ company_domain: "acme.example", qualification_status: "qualified" }), lead({ company_domain: "beta.example", qualification_status: "not_qualified" })];
    const score = scoreQualification(leads, { "acme.example": "qualified", "beta.example": "not_qualified" });

    expect(score.labeledCount).toBe(2);
    expect(score.correctCount).toBe(2);
    expect(score.accuracy).toBe(1);
    expect(score.mismatches).toEqual([]);
  });

  it("records a mismatch when the model's verdict disagrees with the ground truth", () => {
    const leads = [lead({ company_domain: "acme.example", qualification_status: "qualified" })];
    const score = scoreQualification(leads, { "acme.example": "not_qualified" });

    expect(score.correctCount).toBe(0);
    expect(score.accuracy).toBe(0);
    expect(score.mismatches).toEqual([{ companyDomain: "acme.example", expected: "not_qualified", actual: "qualified" }]);
  });

  it("skips domains the ground truth doesn't cover, rather than penalizing them", () => {
    const leads = [lead({ company_domain: "unlabeled.example", qualification_status: "qualified" })];
    const score = scoreQualification(leads, { "acme.example": "qualified" });

    expect(score.labeledCount).toBe(0);
    expect(score.accuracy).toBeNull();
  });

  it("treats needs_review and disqualified as the same not_qualified verdict", () => {
    const leads = [lead({ company_domain: "acme.example", qualification_status: "needs_review" })];
    const score = scoreQualification(leads, { "acme.example": "not_qualified" });

    expect(score.correctCount).toBe(1);
  });
});

describe("scoreGrounding", () => {
  it("flags a draft with a fabricated specific claim not present in the source summary", () => {
    const theLead = lead({ id: "lead-1", source_summary: "Acme builds ops tooling for logistics teams." });
    const drafts = [draft("lead-1", { body: "Acme Inc just raised a $50M Series C led by Sequoia Capital." })];
    const score = scoreGrounding(drafts, new Map([["lead-1", theLead]]));

    expect(score.totalDrafts).toBe(1);
    expect(score.flaggedDrafts).toBe(1);
    expect(score.flaggedRatio).toBe(1);
    expect(score.flagged[0].unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("does not flag a draft whose claims are grounded in the source summary", () => {
    const theLead = lead({ id: "lead-1", source_summary: "Acme builds ops tooling for logistics teams." });
    const drafts = [draft("lead-1", { body: "I noticed Acme builds ops tooling for logistics teams." })];
    const score = scoreGrounding(drafts, new Map([["lead-1", theLead]]));

    expect(score.flaggedDrafts).toBe(0);
    expect(score.flaggedRatio).toBe(0);
  });

  it("returns a null ratio, not a divide-by-zero, when there are no drafts", () => {
    const score = scoreGrounding([], new Map());
    expect(score.totalDrafts).toBe(0);
    expect(score.flaggedRatio).toBeNull();
  });

  it("skips a draft whose lead isn't in the map rather than throwing", () => {
    const drafts = [draft("missing-lead")];
    const score = scoreGrounding(drafts, new Map());
    expect(score.totalDrafts).toBe(1);
    expect(score.flaggedDrafts).toBe(0);
  });
});

describe("scoreInjectionBehavior", () => {
  it("counts injection-flagged leads against the total", () => {
    const leads = [lead({ injection_flagged: true }), lead({ injection_flagged: false })];
    const score = scoreInjectionBehavior(leads);
    expect(score).toEqual({ flaggedLeadCount: 1, totalLeadCount: 2 });
  });

  it("scores zero flagged leads honestly when the run never encountered an injection attempt", () => {
    const leads = [lead({ injection_flagged: false })];
    const score = scoreInjectionBehavior(leads);
    expect(score.flaggedLeadCount).toBe(0);
  });
});
