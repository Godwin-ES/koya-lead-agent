import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createTestUser, dbClient, insertTestRun } from "../helpers/db.js";

/**
 * `claim_next_run(worker_id)` - SYSTEM-DESIGN-NEXTJS.md §6: "Only the
 * worker moves a run into running, and only via claim_next_run." Uses
 * `FOR UPDATE SKIP LOCKED` so two workers racing for the same queue never
 * both win the same run (§5's justification for Supabase-as-queue).
 */
describe("claim_next_run", () => {
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

  async function queuedRun(queuedAt = new Date().toISOString()) {
    const id = await insertTestRun(db, ownerId, { status: "queued", queued_at: queuedAt });
    runIds.push(id);
    return id;
  }

  it("returns null when there is nothing queued", async () => {
    const result = await db.query("select * from claim_next_run($1)", ["w1"]);
    // A non-SETOF composite-returning function called in a NULL FROM
    // context still produces one row - of all-null columns - not zero
    // rows. Confirmed empirically against the live function before
    // writing this assertion.
    expect(result.rows[0]!.id).toBeNull();
  });

  // Real incident: a developer's live worker claimed test runs from the
  // shared queue and ran them live, spending real money and overwriting
  // committed fixtures. Test runs are replay runs (the column default).
  it("only claims runs made for the worker's own mode - a live worker never takes a replay (test) run", async () => {
    const replayRun = await queuedRun();

    // Rolled back: in the shared database a live-mode claim could otherwise take a real queued run.
    await db.query("begin");
    const live = await db.query("select * from claim_next_run($1, $2)", ["live-worker", false]);
    await db.query("rollback");
    expect(live.rows[0]!.id).not.toBe(replayRun);

    const replay = await db.query("select * from claim_next_run($1, $2)", ["replay-worker", true]);
    expect(replay.rows[0]!.id).toBe(replayRun);
  });

  it("claims the oldest queued run, sets status/worker_id/heartbeat_at/started_at", async () => {
    const older = await queuedRun(new Date(Date.now() - 60_000).toISOString());
    await queuedRun();

    const result = await db.query("select * from claim_next_run($1)", ["w1"]);
    const claimed = result.rows[0]!;
    expect(claimed.id).toBe(older);
    expect(claimed.status).toBe("running");
    expect(claimed.worker_id).toBe("w1");
    expect(claimed.heartbeat_at).not.toBeNull();
    expect(claimed.started_at).not.toBeNull();
  });

  it("does not claim a draft, running, or terminal run", async () => {
    await insertTestRun(db, ownerId, { status: "draft" }).then((id) => runIds.push(id));
    await insertTestRun(db, ownerId, { status: "running", worker_id: "someone-else" }).then((id) => runIds.push(id));

    // A run only ever reaches 'completed' via finalize_run in real usage
    // (Task 4's trigger refuses a direct insert-as-completed with no
    // quality report on file yet) - so exercise that same real path here:
    // insert as running, attach a report, then transition to completed.
    const completedId = await insertTestRun(db, ownerId, { status: "running", worker_id: "w0" });
    runIds.push(completedId);
    await db.query(
      `insert into run_quality_reports (run_id, checks, scorecard, passed, summary) values ($1, '[]', '[]', true, 'ok')`,
      [completedId],
    );
    await db.query("update runs set status = 'completed' where id = $1", [completedId]);

    const result = await db.query("select * from claim_next_run($1)", ["w1"]);
    expect(result.rows[0]!.id).toBeNull();
  });

  it("gives a queued run to exactly one of two concurrent workers", async () => {
    await queuedRun();

    const claim = (workerId: string) => db2query(db, workerId);
    async function db2query(client: Client, workerId: string) {
      const r = await client.query("select * from claim_next_run($1)", [workerId]);
      return r.rows[0]!;
    }

    // Two genuinely separate connections, so FOR UPDATE SKIP LOCKED is
    // actually exercised - two queries on the same connection would just
    // run sequentially and prove nothing about concurrency.
    const dbB = dbClient();
    await dbB.connect();
    try {
      const [a, b] = await Promise.all([claim("w1"), db2query(dbB, "w2")]);
      const actuallyClaimed = [a, b].filter((r) => r.id !== null);
      expect(actuallyClaimed).toHaveLength(1);
    } finally {
      await dbB.end();
    }
  });
});
