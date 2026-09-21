import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, rmSync } from "node:fs";
import {
  discover,
  dispatchRaw,
  __resetSpendCacheForTests,
  type DiscoverContext,
} from "@core/providers/discovery/apify";
import { fixturePathFor, saveFixture } from "@core/providers/replay/fixtures";

/**
 * SYSTEM-DESIGN-NEXTJS.md §1 Step 3 / §11: Apify runs always carry an
 * explicit cap, clamped server-side - an uncapped call must be
 * inexpressible in code, not just disciplined about. All of these run in
 * replay mode against fixtures; none make a real Apify call or spend
 * against the shared $5 cohort budget (see the project-wide Global
 * Constraint on automated tests never touching a real external call).
 */
describe("apify discovery adapter", () => {
  const previousReplayMode = process.env.REPLAY_MODE;
  const seededKeys: string[] = [];

  beforeEach(() => {
    process.env.REPLAY_MODE = "true";
    __resetSpendCacheForTests();
  });

  afterEach(() => {
    process.env.REPLAY_MODE = previousReplayMode;
    for (const key of seededKeys.splice(0)) {
      const filePath = fixturePathFor(key);
      if (existsSync(filePath)) rmSync(filePath);
    }
  });

  function seed(key: string, value: unknown) {
    saveFixture(key, value);
    seededKeys.push(key);
    return key;
  }

  const baseContext: DiscoverContext = {
    limits: { candidate_limit: 25 },
    counters: { candidates_seen: 20 },
  };

  it("clamps a requested cap to the run's remaining candidate budget", async () => {
    const key = seed("apify:discover:remaining-budget-test", {
      run: { defaultDatasetId: "ds1" },
      items: [],
    });
    const call = await discover(baseContext, { query: "saas companies", requested: 100 }, { fixtureKeyOverride: key });
    expect(call.input.maxItems).toBe(5);
  });

  it("never requests more than the caller asked for, even with budget to spare", async () => {
    const key = seed("apify:discover:small-request-test", { run: { defaultDatasetId: "ds1" }, items: [] });
    const call = await discover(
      { limits: { candidate_limit: 25 }, counters: { candidates_seen: 0 } },
      { query: "saas companies", requested: 3 },
      { fixtureKeyOverride: key },
    );
    expect(call.input.maxItems).toBe(3);
  });

  it("refuses to dispatch with no cap set - an uncapped call cannot be expressed", async () => {
    await expect(dispatchRaw({ input: { query: "saas" } } as never)).rejects.toThrow(/cap required/i);
  });

  it("returns cached results without dispatching a new actor run", async () => {
    const key = seed("apify:discover:cache-hit-test", {
      run: { defaultDatasetId: "ds1" },
      items: [{ name: "Acme Inc", domain: "acme.example" }],
    });
    const dispatchSpy = vi.fn();
    const result = await discover(baseContext, { query: "saas companies", requested: 5 }, {
      fixtureKeyOverride: key,
      dispatchOverride: dispatchSpy,
    });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(result.candidates).toHaveLength(1);
  });

  it("records estimated spend for every returned result", async () => {
    const key = seed("apify:discover:spend-test", {
      run: { defaultDatasetId: "ds1" },
      items: [
        { name: "Acme Inc", domain: "acme.example" },
        { name: "Widget Co", domain: "widgetco.example" },
      ],
    });
    const result = await discover(baseContext, { query: "saas companies", requested: 5 }, { fixtureKeyOverride: key });
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.itemCount).toBe(2);
  });

  it("skips a candidate with no resolvable domain without consuming budget", async () => {
    const key = seed("apify:discover:missing-domain-test", {
      run: { defaultDatasetId: "ds1" },
      items: [
        { name: "Acme Inc", domain: "acme.example" },
        { name: "No Domain Co", domain: null },
        { name: "", domain: "" },
      ],
    });
    const result = await discover(baseContext, { query: "saas companies", requested: 5 }, { fixtureKeyOverride: key });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.companyDomain).toBe("acme.example");
  });

  it("refuses to dispatch when the run-level spend ceiling is already exhausted", async () => {
    await expect(
      discover(
        { limits: { candidate_limit: 25, max_spend_usd: 0 }, counters: { candidates_seen: 0 } },
        { query: "saas companies", requested: 5 },
        {},
      ),
    ).rejects.toThrow(/spend ceiling/i);
  });
});
