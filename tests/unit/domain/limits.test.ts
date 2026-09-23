import { describe, expect, it } from "vitest";
import { clampLimits, deriveLimitsFromTarget, LIMIT_DEFAULTS } from "@core/domain/limits";

// Ranges below are exactly SYSTEM-DESIGN-NEXTJS.md §7's "Intake and Visible
// Defaults" table.
describe("clampLimits", () => {
  it("clamps a request above the ceiling instead of rejecting it", () => {
    const clamped = clampLimits({ target_qualified: 999, candidate_limit: 999, scrape_limit: 999 });
    expect(clamped.target_qualified).toBe(10);
    expect(clamped.candidate_limit).toBe(40);
    expect(clamped.scrape_limit).toBe(40);
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

// The only user-facing intake input is target_qualified now - everything
// else is a fixed, non-dollar constant, deliberately NOT scaled by
// target_qualified: candidate_limit is sized for the worst case (the
// highest target_qualified can be) and matched 1:1 to a single Apify
// actor dispatch's own cap, not to how many leads this particular run
// happens to want. See deriveLimitsFromTarget's own comment for why -
// this replaced an earlier proportional-ratio design after a real run
// showed the dollar-based spend ceiling firing on an inflated cost
// estimate rather than a real problem.
describe("deriveLimitsFromTarget", () => {
  it("returns the same fixed candidate/scrape/turn/tool-call limits regardless of target_qualified", () => {
    const small = deriveLimitsFromTarget(1);
    const large = deriveLimitsFromTarget(10);
    expect(small.candidate_limit).toBe(40);
    expect(small.scrape_limit).toBe(80);
    expect(small.max_turns).toBe(150);
    expect(small.max_tool_calls).toBe(300);
    expect(large.candidate_limit).toBe(small.candidate_limit);
    expect(large.scrape_limit).toBe(small.scrape_limit);
    expect(large.max_turns).toBe(small.max_turns);
    expect(large.max_tool_calls).toBe(small.max_tool_calls);
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

