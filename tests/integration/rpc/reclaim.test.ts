import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createTestUser, dbClient, insertTestRun } from "../helpers/db.js";

/**
 * `reclaim_stale_runs()` - SYSTEM-DESIGN-NEXTJS.md §6: a run whose
 * heartbeat is older than 90s returns to queued with attempt+1, or goes
 * to failed once attempt >= 3. This is what makes a worker crash or a
 * redeploy self-heal instead of leaving a run stuck in running forever.
 */
describe("reclaim_stale_runs", () => {
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

  async function staleRun(attempt: number, secondsStale = 120) {
    const id = await insertTestRun(db, ownerId, {
      status: "running",
      worker_id: "w1",
      heartbeat_at: new Date(Date.now() - secondsStale * 1000).toISOString(),
      attempt,
    });
    runIds.push(id);
    return id;
  }

  it("leaves a run with a fresh heartbeat alone", async () => {
    const id = await staleRun(0, 10); // 10s stale, under the 90s threshold
    await db.query("select reclaim_stale_runs()");
    const row = (await db.query("select status, attempt from runs where id = $1", [id])).rows[0]!;
    expect(row.status).toBe("running");
    expect(row.attempt).toBe(0);
  });

  it("requeues a stale run with attempt incremented and clears worker_id/heartbeat_at", async () => {
    const id = await staleRun(0);
    await db.query("select reclaim_stale_runs()");
    const row = (await db.query("select status, attempt, worker_id, heartbeat_at from runs where id = $1", [id]))
      .rows[0]!;
    expect(row.status).toBe("queued");
    expect(row.attempt).toBe(1);
    expect(row.worker_id).toBeNull();
    expect(row.heartbeat_at).toBeNull();
  });

  it("fails a run outright once attempt is already at 3", async () => {
    const id = await staleRun(3);
    await db.query("select reclaim_stale_runs()");
    const row = (await db.query("select status, failure_reason from runs where id = $1", [id])).rows[0]!;
    expect(row.status).toBe("failed");
    expect(row.failure_reason).toMatch(/heartbeat/i);
  });

  it("is idempotent - a second call does nothing further to an already-reclaimed run", async () => {
    const id = await staleRun(0);
    await db.query("select reclaim_stale_runs()");
    const afterFirst = (await db.query("select status, attempt from runs where id = $1", [id])).rows[0]!;

    await db.query("select reclaim_stale_runs()");
    const afterSecond = (await db.query("select status, attempt from runs where id = $1", [id])).rows[0]!;

    expect(afterSecond).toEqual(afterFirst);
  });

  it("returns the ids of every run it touched", async () => {
    const a = await staleRun(0);
    const b = await staleRun(3);
    const result = await db.query("select reclaim_stale_runs() as reclaimed");
    const reclaimed: string[] = result.rows[0]!.reclaimed;
    expect(reclaimed).toEqual(expect.arrayContaining([a, b]));
  });
});
