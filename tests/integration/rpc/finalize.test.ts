import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createTestUser, dbClient, insertTestRun } from "../helpers/db.js";

/**
 * `finalize_run(...)` - SYSTEM-DESIGN-NEXTJS.md §16: "idempotent; writes
 * the quality report." Owns the transactional half (persist the report,
 * atomically decide completed vs partial from the actual qualified count)
 * - the report's actual check/scorecard *content* is computed by Task 19's
 * quality module and passed in as parameters, not computed here.
 *
 * `run_summary(run_id)` - the read-only, uncounted status check the
 * `list_run_state` tool (Task 12) uses so the agent can see its own
 * progress without spending a budgeted call to find out.
 */
describe("finalize_run", () => {
  let db: Client;
  let ownerId: string;
  let cleanupOwner: () => Promise<void>;
  const runIds: string[] = [];

  beforeAll(async () => {
    db = dbClient();
    await db.connect();
    const owner = await createTestUser();
    ownerId = owner.userId;
    cleanupOwner = owner.cleanup;
  });

  afterEach(async () => {
    for (const id of runIds.splice(0)) {
      await db.query("delete from runs where id = $1", [id]);
    }
  });

  afterAll(async () => {
    await db.end();
    await cleanupOwner();
  });

  async function runWithQualifiedLeads(count: number, target: number) {
    const id = await insertTestRun(db, ownerId, { status: "running", worker_id: "w1", limits: { target_qualified: target } });
    runIds.push(id);
    for (let i = 0; i < count; i++) {
      await db.query(
        `insert into leads (run_id, company_name, company_domain, qualification_status, confidence, source_urls, fit_reasons)
         values ($1, $2, $3, 'qualified', 0.8, $4, $5)`,
        [id, `Company ${i}`, `company${i}.example`, [`https://company${i}.example`], ["fits"]],
      );
    }
    return id;
  }

  const report = { checks: JSON.stringify([{ id: "x", passed: true }]), scorecard: JSON.stringify([]), passed: true, summary: "ok" };

  it("marks the run completed when qualified_count meets the target", async () => {
    const runId = await runWithQualifiedLeads(10, 10);
    const result = await db.query(
      "select * from finalize_run($1, $2, $3, $4, $5)",
      [runId, report.checks, report.scorecard, report.passed, report.summary],
    );
    expect(result.rows[0]!.status).toBe("completed");

    const stored = (await db.query("select passed, summary from run_quality_reports where run_id = $1", [runId]))
      .rows[0]!;
    expect(stored.passed).toBe(true);
  });

  it("marks the run partial when qualified_count falls short of the target", async () => {
    const runId = await runWithQualifiedLeads(6, 10);
    const result = await db.query(
      "select * from finalize_run($1, $2, $3, $4, $5)",
      [runId, report.checks, report.scorecard, report.passed, "found 6 of 10 within budget"],
    );
    expect(result.rows[0]!.status).toBe("partial");
    expect(result.rows[0]!.partial_reason).toMatch(/6 of 10/);
  });

  it("is idempotent - a second call updates the same report row, not a new one", async () => {
    const runId = await runWithQualifiedLeads(10, 10);
    await db.query("select finalize_run($1, $2, $3, $4, $5)", [runId, report.checks, report.scorecard, report.passed, "first"]);
    await db.query("select finalize_run($1, $2, $3, $4, $5)", [runId, report.checks, report.scorecard, report.passed, "second"]);

    const rows = (await db.query("select summary from run_quality_reports where run_id = $1", [runId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toBe("second");
  });
});

describe("run_summary", () => {
  let db: Client;
  let ownerId: string;
  let cleanupOwner: () => Promise<void>;
  const runIds: string[] = [];

  beforeAll(async () => {
    db = dbClient();
    await db.connect();
    const owner = await createTestUser();
    ownerId = owner.userId;
    cleanupOwner = owner.cleanup;
  });

  afterEach(async () => {
    for (const id of runIds.splice(0)) {
      await db.query("delete from runs where id = $1", [id]);
    }
  });

  afterAll(async () => {
    await db.end();
    await cleanupOwner();
  });

  it("reports live qualified and needs_review counts computed from leads, not a stale cache", async () => {
    const runId = await insertTestRun(db, ownerId, { status: "running", worker_id: "w1", limits: { target_qualified: 10 } });
    runIds.push(runId);
    await db.query(
      `insert into leads (run_id, company_name, company_domain, qualification_status, confidence, source_urls, fit_reasons)
       values ($1, 'A', 'a.example', 'qualified', 0.8, $2, $3)`,
      [runId, ["https://a.example"], ["fits"]],
    );
    await db.query(
      `insert into leads (run_id, company_name, company_domain, qualification_status, confidence, source_urls, fit_reasons)
       values ($1, 'B', 'b.example', 'needs_review', 0.5, '{}', '{}')`,
      [runId],
    );

    const result = await db.query("select run_summary($1) as summary", [runId]);
    const summary = result.rows[0]!.summary;
    expect(summary.qualified_count).toBe(1);
    expect(summary.needs_review_count).toBe(1);
    expect(summary.limits.target_qualified).toBe(10);
    expect(summary.status).toBe("running");
  });
});
