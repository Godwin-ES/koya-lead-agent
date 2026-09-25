import { describe, expect, it } from "vitest";
import { interruptibleSleep, readStopRequest, RunStopRequested } from "../../../worker/src/run-control";
import { createFakeSupabase } from "../tools/support/fake-supabase";

describe("readStopRequest", () => {
  function withRun(row: Record<string, unknown>) {
    const { client, tables } = createFakeSupabase();
    tables.runs.push({ id: "run-1", status: "running", pause_requested_at: null, ...row });
    return client;
  }

  it("is null for a running run with nothing requested", async () => {
    expect(await readStopRequest(withRun({}), "run-1")).toBeNull();
  });

  it("reports the user's pause and cancel", async () => {
    expect(await readStopRequest(withRun({ pause_requested_at: new Date().toISOString() }), "run-1")).toBe("pause");
    expect(await readStopRequest(withRun({ status: "cancelled" }), "run-1")).toBe("user_cancel");
  });

  it("puts a worker shutdown first - the run is requeued, whatever else was requested", async () => {
    expect(await readStopRequest(withRun({ pause_requested_at: new Date().toISOString() }), "run-1", () => true)).toBe("shutdown");
  });
});

describe("interruptibleSleep", () => {
  it("ends a wait early by throwing when a stop is requested", async () => {
    let checks = 0;
    const sleep = interruptibleSleep(async () => (++checks >= 2 ? "pause" : null), 5);
    await expect(sleep(10_000)).rejects.toEqual(new RunStopRequested("pause"));
    expect(checks).toBe(2);
  });

  it("waits the full time when nothing is requested", async () => {
    const started = Date.now();
    await interruptibleSleep(async () => null, 5)(30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});
