import { describe, expect, it } from "vitest";
import { clampLimits, deriveLimitsFromTarget, extendLimits, searchesLeftToAdd, LIMIT_DEFAULTS, MAX_SEARCHES } from "@core/domain/limits";

// Ranges below are exactly SYSTEM-DESIGN-NEXTJS.md §7's "Intake and Visible
// Defaults" table.
describe("clampLimits", () => {
  it("clamps a request above the ceiling instead of rejecting it", () => {
    const clamped = clampLimits({ target_qualified: 999, candidate_limit: 999, scrape_limit: 999 });
    expect(clamped.target_qualified).toBe(10);
    expect(clamped.candidate_limit).toBe(150);
    expect(clamped.scrape_limit).toBe(300);
  });

  it("clamps a request below the floor up to the minimum of 1", () => {
    const clamped = clampLimits({ target_qualified: 0, candidate_limit: -5, scrape_limit: 0 });
    expect(clamped.target_qualified).toBe(1);
    expect(clamped.candidate_limit).toBe(1);
    expect(clamped.scrape_limit).toBe(1);
  });

  it("passes an in-range request through unchanged", () => {
    const clamped = clampLimits({ target_qualified: 7, candidate_limit: 30, scrape_limit: 20 });
    expect(clamped).toMatchObject({ target_qualified: 7, candidate_limit: 30, scrape_limit: 20 });
  });

  it("fills in the spec defaults for anything not supplied", () => {
    const clamped = clampLimits({});
    expect(clamped).toMatchObject(LIMIT_DEFAULTS);
  });

  it("floors max_turns, max_tool_calls, and max_spend_usd at their minimums without inventing a ceiling", () => {
    const clamped = clampLimits({ max_turns: 0, max_tool_calls: -1, max_spend_usd: -0.5 });
    expect(clamped.max_turns).toBeGreaterThanOrEqual(1);
    expect(clamped.max_tool_calls).toBeGreaterThanOrEqual(1);
    expect(clamped.max_spend_usd).toBeGreaterThanOrEqual(0);
  });
});

// The only user-facing intake input is target_qualified - everything else
// is derived from it. candidate_limit covers MAX_DISCOVER_ATTEMPTS full
// pages of candidatesPerDiscoverCall (2x target, within [10, 25]), and
// scrape_limit is 2 pages per candidate.
describe("deriveLimitsFromTarget", () => {
  it("sizes candidate_limit as 3 attempts of the per-call size, and scrape_limit as 2 pages per candidate", () => {
    expect(deriveLimitsFromTarget(1)).toMatchObject({ candidate_limit: 30, scrape_limit: 60 });
    expect(deriveLimitsFromTarget(5)).toMatchObject({ candidate_limit: 30, scrape_limit: 60 });
    expect(deriveLimitsFromTarget(8)).toMatchObject({ candidate_limit: 48, scrape_limit: 96 });
    expect(deriveLimitsFromTarget(10)).toMatchObject({ candidate_limit: 60, scrape_limit: 120 });
  });

  it("stays inside clampLimits' own ranges at the largest target", () => {
    const derived = deriveLimitsFromTarget(10);
    expect(clampLimits(derived)).toEqual(derived);
  });

  it("sets max_spend_usd high enough that it can never realistically bind - nothing gates on it anymore", () => {
    const derived = deriveLimitsFromTarget(5);
    expect(derived.max_spend_usd).toBeGreaterThan(100);
  });

  it("still clamps target_qualified itself to the 1-10 range", () => {
    expect(deriveLimitsFromTarget(999).target_qualified).toBe(10);
    expect(deriveLimitsFromTarget(0).target_qualified).toBe(1);
    expect(deriveLimitsFromTarget(-5).target_qualified).toBe(1);
    expect(deriveLimitsFromTarget(Number.NaN).target_qualified).toBe(1);
  });

  it("honors the requested target_qualified within range", () => {
    expect(deriveLimitsFromTarget(5).target_qualified).toBe(5);
    expect(deriveLimitsFromTarget(3).target_qualified).toBe(3);
  });
});


describe("extendLimits (Continue with more budget)", () => {
  const base = deriveLimitsFromTarget(10); // 3 searches of 20: 60 candidates, 120 scrape pages

  it("adds searches, each with its own candidates and scrape pages", () => {
    const extended = extendLimits(base, 2, "searches");
    expect(extended).toMatchObject({ max_discover_attempts: 5, candidate_limit: 100, scrape_limit: 200 });
    expect(extended.max_turns).toBeGreaterThan(base.max_turns);
  });

  it("gives whatever actually stopped the run room, even with no new searches", () => {
    expect(extendLimits(base, 0, "scrapes").scrape_limit).toBe(160);
    expect(extendLimits(base, 0, "candidates").candidate_limit).toBe(80);
    expect(extendLimits(base, 0, "turns").max_turns).toBe(base.max_turns + 75);
    expect(extendLimits(base, 0, "tool_calls").max_tool_calls).toBe(base.max_tool_calls + 150);
  });

  it("never goes past the most searches a run can have", () => {
    const maxed = extendLimits(base, 10, "searches");
    expect(maxed.max_discover_attempts).toBe(MAX_SEARCHES);
    expect(searchesLeftToAdd(maxed)).toBe(0);
    expect(searchesLeftToAdd({})).toBe(MAX_SEARCHES - 3);
  });
});
