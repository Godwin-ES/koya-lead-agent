import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, rmSync } from "node:fs";
import {
  buildActorInput,
  discover,
  dispatchRaw,
  COST_PER_RESULT_USD,
  COST_PER_RUN_START_USD,
  type DiscoverContext,
  type DiscoverRequest,
} from "@core/providers/discovery/apify";
import { fixturePathFor, saveFixture } from "@core/providers/replay/fixtures";

/**
 * harvestapi/linkedin-company-search adapter. Every call here runs in
 * replay mode against a seeded fixture - none make a real Apify call.
 */
describe("apify discovery adapter (harvestapi/linkedin-company-search)", () => {
  const previousReplayMode = process.env.REPLAY_MODE;
  const seededKeys: string[] = [];

  beforeEach(() => {
    process.env.REPLAY_MODE = "true";
  });

  afterEach(() => {
    process.env.REPLAY_MODE = previousReplayMode;
    for (const key of seededKeys.splice(0)) {
      const filePath = fixturePathFor(key);
      if (existsSync(filePath)) rmSync(filePath);
    }
  });

  function seed(key: string, items: Record<string, unknown>[]) {
    saveFixture(key, { run: { defaultDatasetId: "ds1" }, items });
    seededKeys.push(key);
    return key;
  }

  function item(name: string, website: string | null, total = 130): Record<string, unknown> {
    return {
      id: `id-${name}`,
      name,
      website,
      employeeCountRange: { start: 11, end: 50 },
      locations: [{ headquarter: true, parsed: { text: "Austin, TX, United States", country: "United States", countryCode: "US" } }],
      industries: [{ id: "4", name: "Software Development" }],
      _meta: { pagination: { totalResultCount: total } },
    };
  }

  const request: DiscoverRequest = {
    industryIds: ["4"],
    keyword: "platform",
    locations: ["United States"],
    companySize: ["11-50", "51-200"],
    page: 1,
    requested: 20,
  };
  const context: DiscoverContext = { limits: { candidate_limit: 60 }, counters: { candidates_seen: 0 } };

  it("builds the actor's own input shape, full mode, with the structured filters", () => {
    expect(buildActorInput(request, 20)).toEqual({
      scraperMode: "full",
      maxItems: 20,
      industryIds: ["4"],
      locations: ["United States"],
      startPage: 1,
      searchQuery: "platform",
      companySize: ["11-50", "51-200"],
    });
  });

  it("omits searchQuery and companySize when there's no keyword or size bound", () => {
    const input = buildActorInput({ ...request, keyword: null, companySize: [] }, 10);
    expect(input).not.toHaveProperty("searchQuery");
    expect(input).not.toHaveProperty("companySize");
  });

  it("clamps the cap to the run's remaining candidate budget", async () => {
    const key = seed("apify:discover:remaining-budget-test", []);
    const result = await discover({ limits: { candidate_limit: 60 }, counters: { candidates_seen: 55 } }, request, { fixtureKeyOverride: key });
    expect(result.input.maxItems).toBe(5);
  });

  it("makes no call at all when the budget is spent", async () => {
    const dispatchSpy = vi.fn();
    const result = await discover({ limits: { candidate_limit: 60 }, counters: { candidates_seen: 60 } }, request, { dispatchOverride: dispatchSpy });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ itemCount: 0, estimatedCostUsd: 0 });
  });

  it("refuses to dispatch with no cap set - an uncapped call cannot be expressed", async () => {
    await expect(dispatchRaw({ input: { searchQuery: "platform" } })).rejects.toThrow(/cap required/i);
  });

  it("reads the replay fixture instead of dispatching", async () => {
    const key = seed("apify:discover:cache-hit-test", [item("Acme", "https://acme.example")]);
    const dispatchSpy = vi.fn();
    const result = await discover(context, request, { fixtureKeyOverride: key, dispatchOverride: dispatchSpy });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(result.candidates[0]).toMatchObject({ name: "Acme", domain: "acme.example" });
  });

  it("reports LinkedIn's pool size from the result metadata", async () => {
    const key = seed("apify:discover:pool-size-test", [item("Acme", "https://acme.example", 130)]);
    expect((await discover(context, request, { fixtureKeyOverride: key })).totalResultCount).toBe(130);
  });

  // The previous adapter sliced results to the cap after receiving them,
  // which saved nothing (Apify had already billed) and under-reported
  // cost. The cap is enforced in the request; cost is whatever came back.
  it("reports real cost from everything the actor returned - run start plus every billed result, no truncation", async () => {
    const items = Array.from({ length: 3 }, (_, i) => item(`Co ${i}`, `https://co${i}.example`));
    const key = seed("apify:discover:cost-test", items);
    const result = await discover({ limits: { candidate_limit: 60 }, counters: { candidates_seen: 0 } }, { ...request, requested: 2 }, { fixtureKeyOverride: key });
    expect(result.itemCount).toBe(3);
    expect(result.candidates).toHaveLength(3);
    expect(result.estimatedCostUsd).toBeCloseTo(COST_PER_RUN_START_USD + 3 * COST_PER_RESULT_USD);
  });

  it("counts an item that fails to normalize as billed, but not as a candidate", async () => {
    const key = seed("apify:discover:unnamed-item-test", [item("Acme", "https://acme.example"), { id: "x", name: "" }]);
    const result = await discover(context, request, { fixtureKeyOverride: key });
    expect(result.itemCount).toBe(2);
    expect(result.candidates).toHaveLength(1);
  });
  // Live: page 2 came back "Found 0 profiles on the page", and the identical
  // input returned 50 minutes later. These run the live path with a stubbed
  // dispatch - REPLAY_MODE=false, but no network call is made.
  describe("an empty page after the first", () => {
    const empty = { run: { defaultDatasetId: "ds-empty" }, items: [] };
    const full = { run: { defaultDatasetId: "ds-full" }, items: [item("Acme", "https://acme.example")] };

    function liveKey(name: string) {
      process.env.REPLAY_MODE = "false";
      const key = `apify:discover:${name}`;
      seededKeys.push(key);
      return key;
    }

    it("is retried once, and both run starts are costed", async () => {
      const dispatch = vi.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce(full);
      const result = await discover(context, { ...request, page: 2 }, { fixtureKeyOverride: liveKey("retry-page-2"), dispatchOverride: dispatch });
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(result.itemCount).toBe(1);
      expect(result.estimatedCostUsd).toBeCloseTo(2 * COST_PER_RUN_START_USD + COST_PER_RESULT_USD);
    });

    it("is not retried more than once", async () => {
      const dispatch = vi.fn().mockResolvedValue(empty);
      const result = await discover(context, { ...request, page: 3 }, { fixtureKeyOverride: liveKey("retry-once"), dispatchOverride: dispatch });
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(result.itemCount).toBe(0);
    });

    it("isn't retried on page 1, where empty usually means no matches", async () => {
      const dispatch = vi.fn().mockResolvedValue(empty);
      await discover(context, request, { fixtureKeyOverride: liveKey("no-retry-page-1"), dispatchOverride: dispatch });
      expect(dispatch).toHaveBeenCalledTimes(1);
    });
  });
});
