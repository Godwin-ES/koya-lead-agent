import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { withRecording, isReplayMode } from "@core/providers/replay/recorder";
import { fixturePathFor, loadFixture } from "@core/providers/replay/fixtures";

/**
 * SYSTEM-DESIGN-NEXTJS.md §11: every external call (Apify, Crawl4AI,
 * Firecrawl, and every Claude/Gemini call) goes through this harness.
 * No automated test may ever make a real external call - see the Global
 * Constraint added after the Task 5/6 conversation about not burning
 * credits on repeatable tests.
 */
describe("withRecording", () => {
  const previousReplayMode = process.env.REPLAY_MODE;
  const testKeys = ["apify:test", "apify:absent", "apify:record-me"];

  afterEach(() => {
    process.env.REPLAY_MODE = previousReplayMode;
    for (const key of testKeys) {
      const filePath = fixturePathFor(key);
      if (existsSync(filePath)) rmSync(filePath);
    }
  });

  it("never performs network io in replay mode", async () => {
    process.env.REPLAY_MODE = "true";
    // Seed a fixture directly via recording mode first, so the replay
    // read below has something real to load.
    process.env.REPLAY_MODE = "false";
    await withRecording("apify:test", async () => ({ items: ["seeded"] }));

    process.env.REPLAY_MODE = "true";
    const spy = vi.fn();
    const out = await withRecording("apify:test", spy);
    expect(spy).not.toHaveBeenCalled();
    expect(out).toEqual(loadFixture("apify:test"));
    expect(out).toEqual({ items: ["seeded"] });
  });

  it("fails loudly when a fixture is missing in replay mode", async () => {
    process.env.REPLAY_MODE = "true";
    await expect(withRecording("apify:absent", vi.fn())).rejects.toThrow(/fixture missing/i);
  });

  it("defaults to replay mode when REPLAY_MODE is unset - never accidentally live", async () => {
    delete process.env.REPLAY_MODE;
    expect(isReplayMode()).toBe(true);
    const spy = vi.fn();
    await expect(withRecording("apify:absent", spy)).rejects.toThrow(/fixture missing/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls the real function and records its result only when REPLAY_MODE=false", async () => {
    process.env.REPLAY_MODE = "false";
    const spy = vi.fn().mockResolvedValue({ ok: true, value: 42 });
    const out = await withRecording("apify:record-me", spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ ok: true, value: 42 });

    // A subsequent replay-mode call reads back exactly what was recorded.
    process.env.REPLAY_MODE = "true";
    const replaySpy = vi.fn();
    const replayed = await withRecording("apify:record-me", replaySpy);
    expect(replaySpy).not.toHaveBeenCalled();
    expect(replayed).toEqual({ ok: true, value: 42 });
  });
});
