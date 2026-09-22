import { describe, expect, it } from "vitest";
import { clampLimits, deriveLimitsFromTarget, estimateMaxSpendUsd, LIMIT_DEFAULTS } from "@core/domain/limits";

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
// else is derived server-side, never trusted from the client, so this
// function is the one place the actual policy ratios live.
describe("deriveLimitsFromTarget", () => {
  it("reproduces today's candidate/scrape/tool-call/turn defaults at target_qualified = 10, with a deliberately raised spend ceiling", () => {
    const derived = deriveLimitsFromTarget(10);
    expect(derived).toMatchObject({
      target_qualified: LIMIT_DEFAULTS.target_qualified,
      candidate_limit: LIMIT_DEFAULTS.candidate_limit,
      scrape_limit: LIMIT_DEFAULTS.scrape_limit,
      max_tool_calls: LIMIT_DEFAULTS.max_tool_calls,
      max_turns: LIMIT_DEFAULTS.max_turns,
    });
    // Deliberately higher than LIMIT_DEFAULTS.max_spend_usd (0.5): model
    // spend scales with turns, not target_qualified, and $0.50 alone was
    // observed getting hit by a single wasted Opus session with zero
    // leads produced (Task 22's live benchmark pass).
    expect(derived.max_spend_usd).toBeCloseTo(0.8, 5);
  });

  it("scales candidate_limit and scrape_limit proportionally at a smaller target", () => {
    const derived = deriveLimitsFromTarget(5);
    expect(derived.candidate_limit).toBe(13); // ceil(5 * 2.5)
    expect(derived.scrape_limit).toBe(15); // ceil(5 * 3)
    expect(derived.max_tool_calls).toBe(60); // scrape_limit * 4
    expect(derived.max_turns).toBe(30); // max_tool_calls / 2
  });

  it("floors max_spend_usd at $0.50 regardless of how small the target is", () => {
    const derived = deriveLimitsFromTarget(1);
    expect(derived.max_spend_usd).toBe(0.5);
  });

  it("scales max_spend_usd above the floor for a larger target", () => {
    const derived = deriveLimitsFromTarget(10);
    expect(derived.max_spend_usd).toBeCloseTo(0.8, 5);
  });

  it("clamps candidate_limit and scrape_limit at 40 even if a caller passes an out-of-range target", () => {
    const derived = deriveLimitsFromTarget(999);
    expect(derived.target_qualified).toBe(10);
    expect(derived.candidate_limit).toBeLessThanOrEqual(40);
    expect(derived.scrape_limit).toBeLessThanOrEqual(40);
  });

  it("clamps target_qualified up to 1 for a non-positive or missing request", () => {
    expect(deriveLimitsFromTarget(0).target_qualified).toBe(1);
    expect(deriveLimitsFromTarget(-5).target_qualified).toBe(1);
    expect(deriveLimitsFromTarget(Number.NaN).target_qualified).toBe(1);
  });
});

describe("estimateMaxSpendUsd", () => {
  it("scales with candidate and scrape limits under the given unit costs", () => {
    const low = estimateMaxSpendUsd(
      { candidate_limit: 10, scrape_limit: 10, scraper: "firecrawl" },
      { perCandidateUsd: 0.01, perScrapeUsd: 0.02 },
    );
    const high = estimateMaxSpendUsd(
      { candidate_limit: 40, scrape_limit: 40, scraper: "firecrawl" },
      { perCandidateUsd: 0.01, perScrapeUsd: 0.02 },
    );
    expect(high).toBeGreaterThan(low);
    expect(low).toBeCloseTo(10 * 0.01 + 10 * 0.02, 5);
  });

  it("treats crawl4ai as free regardless of the supplied per-scrape unit cost", () => {
    const withCrawl4ai = estimateMaxSpendUsd(
      { candidate_limit: 10, scrape_limit: 10, scraper: "crawl4ai" },
      { perCandidateUsd: 0.01, perScrapeUsd: 0.02 },
    );
    // Only the candidate (Apify) cost should show up; scraping is self-hosted and free.
    expect(withCrawl4ai).toBeCloseTo(10 * 0.01, 5);
  });

  it("never returns a negative estimate even with zero limits", () => {
    expect(
      estimateMaxSpendUsd(
        { candidate_limit: 0, scrape_limit: 0, scraper: "firecrawl" },
        { perCandidateUsd: 0.01, perScrapeUsd: 0.02 },
      ),
    ).toBe(0);
  });
});
