import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createTestUser, dbClient, dbPool, insertTestRun } from "../helpers/db.js";

/**
 * `record_tool_call(...)` and `append_agent_event(...)` - both allocate a
 * per-run `seq` atomically (SYSTEM-DESIGN-NEXTJS.md §16: "allocates seq
 * atomically"). This is what makes the tool-call log and the agent
 * timeline orderable and gap-free even when several tool calls resolve in
 * parallel, which is the normal case since parallel tool use is the
 * Agent SDK's default.
 */
describe("record_tool_call", () => {
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

  async function newRun() {
    const id = await insertTestRun(db, ownerId, { status: "running", worker_id: "w1" });
    runIds.push(id);
    return id;
  }

  it("inserts a tool_calls row starting at seq 1", async () => {
    const runId = await newRun();
    const result = await db.query(
      "select * from record_tool_call($1, $2, $3, purpose => $4)",
      [runId, "discover_companies", "ok", "test purpose"],
    );
    expect(result.rows[0]!.seq).toBe(1);
    expect(result.rows[0]!.tool_name).toBe("discover_companies");
    expect(result.rows[0]!.purpose).toBe("test purpose");
  });

  it("allocates strictly increasing, gap-free seq numbers under concurrency", async () => {
    const runId = await newRun();
    // A real Pool, not the single `db` Client - see dbPool()'s doc
    // comment for why a lone Client can't genuinely exercise the
    // advisory lock's concurrent-caller behaviour.
    const pool = dbPool();
    try {
      const calls = Array.from({ length: 20 }, (_, i) =>
        pool.query("select seq from record_tool_call($1, $2, $3)", [runId, `tool_${i}`, "ok"]),
      );
      const results = await Promise.all(calls);
      const seqs = results.map((r) => r.rows[0]!.seq).sort((a, b) => a - b);
      expect(new Set(seqs).size).toBe(20);
      expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    } finally {
      await pool.end();
    }
  });

  it("keeps seq counters independent across two different runs", async () => {
    const runA = await newRun();
    const runB = await newRun();
    await db.query("select record_tool_call($1, $2, $3)", [runA, "t", "ok"]);
    const b1 = await db.query("select seq from record_tool_call($1, $2, $3)", [runB, "t", "ok"]);
    expect(b1.rows[0]!.seq).toBe(1);
  });

  it("records a denial with its reason", async () => {
    const runId = await newRun();
    const result = await db.query(
      "select * from record_tool_call($1, $2, $3, denial_reason => $4)",
      [runId, "scrape_site", "denied", "scrape budget exhausted"],
    );
    expect(result.rows[0]!.status).toBe("denied");
    expect(result.rows[0]!.denial_reason).toBe("scrape budget exhausted");
  });
});

describe("append_agent_event", () => {
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

  it("allocates its own independent, gap-free seq under concurrency", async () => {
    const runId = await insertTestRun(db, ownerId, { status: "running", worker_id: "w1" });
    runIds.push(runId);

    const pool = dbPool();
    try {
      const calls = Array.from({ length: 15 }, () =>
        pool.query("select seq from append_agent_event($1, $2, $3)", [runId, "phase", JSON.stringify({ phase: "icp" })]),
      );
      const results = await Promise.all(calls);
      const seqs = results.map((r) => r.rows[0]!.seq).sort((a, b) => a - b);
      expect(new Set(seqs).size).toBe(15);
      expect(seqs).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    } finally {
      await pool.end();
    }
  });
});
