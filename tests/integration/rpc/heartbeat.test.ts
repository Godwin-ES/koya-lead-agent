import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createTestUser, dbClient, insertTestRun } from "../helpers/db.js";

/**
 * `heartbeat(run_id, worker_id)` - SYSTEM-DESIGN-NEXTJS.md §6: "running
 * requires a worker_id and a heartbeat_at refreshed every 15s." Returns
 * whether the heartbeat actually took, so a worker whose run was reclaimed
 * out from under it (wrong worker_id, or the run moved on) can detect
 * that and stop working rather than keep going on a run it no longer owns.
 */
describe("heartbeat", () => {
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

  it("refreshes heartbeat_at and returns true for the owning worker on a running run", async () => {
    const runId = await insertTestRun(db, ownerId, {
      status: "running",
      worker_id: "w1",
      heartbeat_at: new Date(Date.now() - 30_000).toISOString(),
    });
    runIds.push(runId);

    const before = (await db.query("select heartbeat_at from runs where id = $1", [runId])).rows[0]!.heartbeat_at;

    const result = await db.query("select heartbeat($1, $2) as ok", [runId, "w1"]);
    expect(result.rows[0]!.ok).toBe(true);

    const after = (await db.query("select heartbeat_at from runs where id = $1", [runId])).rows[0]!.heartbeat_at;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it("returns false for the wrong worker_id and does not touch heartbeat_at", async () => {
    const stamp = new Date(Date.now() - 30_000).toISOString();
    const runId = await insertTestRun(db, ownerId, { status: "running", worker_id: "w1", heartbeat_at: stamp });
    runIds.push(runId);

    const result = await db.query("select heartbeat($1, $2) as ok", [runId, "impostor"]);
    expect(result.rows[0]!.ok).toBe(false);

    const after = (await db.query("select heartbeat_at from runs where id = $1", [runId])).rows[0]!.heartbeat_at;
    expect(new Date(after).toISOString()).toBe(new Date(stamp).toISOString());
  });

  it("returns false for a run that is not running", async () => {
    const runId = await insertTestRun(db, ownerId, { status: "queued", worker_id: "w1" });
    runIds.push(runId);

    const result = await db.query("select heartbeat($1, $2) as ok", [runId, "w1"]);
    expect(result.rows[0]!.ok).toBe(false);
  });

  it("returns false for a run that does not exist", async () => {
    const result = await db.query("select heartbeat($1, $2) as ok", ["00000000-0000-0000-0000-000000000000", "w1"]);
    expect(result.rows[0]!.ok).toBe(false);
  });
});
