import { describe, expect, it } from "vitest";
import { clampLimits, estimateMaxSpendUsd, LIMIT_DEFAULTS } from "@core/domain/limits";

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
