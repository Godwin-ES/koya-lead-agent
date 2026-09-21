import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createTestUser, dbClient } from "../helpers/db.js";

/**
 * Asserts the database itself refuses invalid states - these are business
 * rules enforced by CHECK constraints and triggers
 * (SYSTEM-DESIGN-NEXTJS.md §16 "Key constraints that encode business
 * rules"), not application code that a caller could bypass by going
 * straight to the database, which is exactly what these tests do.
 *
 * Runs against the linked Supabase project directly via `pg`
 * (SUPABASE_DB_URL), the same as the plan's own snippet - see the
 * "linked cloud project, not a local stack" note in BUILD-NOTES-NEXTJS.md
 * for why this targets the real project rather than `supabase db reset`.
 */
describe("schema constraints", () => {
  let client: Client;
  let ownerId: string;
  let cleanupOwner: () => Promise<void>;
  const createdRunIds: string[] = [];

  beforeAll(async () => {
    client = dbClient();
    await client.connect();
    const owner = await createTestUser();
    ownerId = owner.userId;
    cleanupOwner = owner.cleanup;
  });

  afterAll(async () => {
    // Deleting the run cascades to leads, outreach_drafts, and every other
    // child table via ON DELETE CASCADE - one delete per run is enough.
    for (const runId of createdRunIds) {
      await client.query("delete from runs where id = $1", [runId]);
    }
    await client.end();
    await cleanupOwner();
  });

  async function insertRun(overrides: Partial<{ status: string }> = {}) {
    const result = await client.query<{ id: string }>(
      `insert into runs (user_id, objective_raw, status)
       values ($1, $2, $3)
       returning id`,
      [ownerId, "Find 10 US B2B SaaS companies with 10 to 100 employees", overrides.status ?? "draft"],
    );
    const id = result.rows[0]!.id;
    createdRunIds.push(id);
    return id;
  }

  async function insertLead(
    runId: string,
    overrides: Partial<{
      company_domain: string;
      qualification_status: string;
      confidence: number;
      source_urls: string[];
      fit_reasons: string[];
    }> = {},
  ) {
    return client.query<{ id: string }>(
      `insert into leads (run_id, company_name, company_domain, qualification_status, confidence, source_urls, fit_reasons)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        runId,
        "Acme Inc",
        overrides.company_domain ?? "acme.example",
        overrides.qualification_status ?? "qualified",
        overrides.confidence ?? 0.8,
        overrides.source_urls ?? ["https://acme.example/about"],
        overrides.fit_reasons ?? ["Matches headcount range"],
      ],
    );
  }

  async function insertDraft(leadId: string) {
    return client.query(
      `insert into outreach_drafts (lead_id, channel, step, subject, body, personalization_note)
       values ($1, 'email', 1, $2, $3, $4)`,
      [leadId, "Quick question about your scaling ops", "Hi there, ...", "Referenced their pricing page"],
    );
  }

  it("refuses a qualified lead with no source url", async () => {
    const runId = await insertRun();
    await expect(
      insertLead(runId, { qualification_status: "qualified", source_urls: [], fit_reasons: ["x"] }),
    ).rejects.toThrow(/qualified_requires_evidence/);
  });

  it("refuses a qualified lead with no fit reasons", async () => {
    const runId = await insertRun();
    await expect(
      insertLead(runId, { qualification_status: "qualified", source_urls: ["https://x.example"], fit_reasons: [] }),
    ).rejects.toThrow(/qualified_requires_evidence/);
  });

  it("allows a not_qualified or needs_review lead with no source url (the evidence rule is qualified-only)", async () => {
    const runId = await insertRun();
    await expect(
      insertLead(runId, { qualification_status: "needs_review", source_urls: [], fit_reasons: [] }),
    ).resolves.toBeDefined();
  });

  it("refuses confidence outside 0 to 1", async () => {
    const runId = await insertRun();
    await expect(insertLead(runId, { confidence: 1.5 })).rejects.toThrow(/confidence_range/);
    await expect(insertLead(runId, { confidence: -0.1 })).rejects.toThrow(/confidence_range/);
  });

  it("refuses an outreach draft attached to a non-qualified lead", async () => {
    const runId = await insertRun();
    const { rows } = await insertLead(runId, { qualification_status: "needs_review", source_urls: [], fit_reasons: [] });
    const needsReviewLeadId = rows[0]!.id;
    await expect(insertDraft(needsReviewLeadId)).rejects.toThrow(/outreach_requires_qualified/);
  });

  it("allows an outreach draft attached to a qualified lead", async () => {
    const runId = await insertRun();
    const { rows } = await insertLead(runId, { qualification_status: "qualified" });
    await expect(insertDraft(rows[0]!.id)).resolves.toBeDefined();
  });

  it("refuses a duplicate company within one run regardless of domain formatting", async () => {
    const runId = await insertRun();
    await insertLead(runId, { company_domain: "https://WWW.Foo.com/pricing" });
    await expect(insertLead(runId, { company_domain: "foo.com" })).rejects.toThrow(/leads_run_domain_key/);
  });

  it("allows the same company domain in two different runs", async () => {
    const runA = await insertRun();
    const runB = await insertRun();
    await insertLead(runA, { company_domain: "shared.example" });
    await expect(insertLead(runB, { company_domain: "shared.example" })).resolves.toBeDefined();
  });

  it("normalizes company_domain on write so lookups don't need to know the formatting", async () => {
    const runId = await insertRun();
    const { rows } = await insertLead(runId, { company_domain: "HTTPS://WWW.Foo.com/pricing?ref=x" });
    const stored = await client.query<{ company_domain: string }>("select company_domain from leads where id = $1", [
      rows[0]!.id,
    ]);
    expect(stored.rows[0]!.company_domain).toBe("foo.com");
  });

  it("refuses completing a run with no quality report", async () => {
    const runId = await insertRun();
    await expect(client.query("update runs set status = 'completed' where id = $1", [runId])).rejects.toThrow(
      /completed_requires_quality_report/,
    );
  });

  it("allows completing a run once a quality report exists", async () => {
    const runId = await insertRun();
    await client.query(
      `insert into run_quality_reports (run_id, checks, scorecard, passed, summary)
       values ($1, '[]'::jsonb, '[]'::jsonb, true, 'ok')`,
      [runId],
    );
    await expect(client.query("update runs set status = 'completed' where id = $1", [runId])).resolves.toBeDefined();
  });

  it("refuses a run status outside the eight-state lifecycle", async () => {
    await expect(insertRun({ status: "bogus" })).rejects.toThrow();
  });
});
