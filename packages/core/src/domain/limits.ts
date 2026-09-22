import type { RunLimits, Scraper } from "./types";

/** SYSTEM-DESIGN-NEXTJS.md §7's "Intake and Visible Defaults" table. */
export const LIMIT_DEFAULTS: RunLimits = {
  target_qualified: 10,
  candidate_limit: 25,
  scrape_limit: 30,
  max_turns: 60,
  max_tool_calls: 120,
  max_spend_usd: 0.5,
};

/**
 * Ranges given explicitly in §7. `target_qualified`, `candidate_limit`, and
 * `scrape_limit` have a spec'd ceiling; `max_turns`, `max_tool_calls`, and
 * `max_spend_usd` only have a spec'd default with no stated ceiling, so
 * those three are floored (never negative, never zero for a count) but
 * never clamped downward from an unbounded request. Inventing an
 * unspecified ceiling for those would be a silent, undocumented policy
 * decision - if one turns out to be needed, it belongs in
 * SYSTEM-DESIGN-NEXTJS.md §7 first, not buried in this function.
 */
const RANGES: Partial<Record<keyof RunLimits, { min: number; max: number }>> = {
  target_qualified: { min: 1, max: 10 },
  candidate_limit: { min: 1, max: 40 },
  scrape_limit: { min: 1, max: 40 },
};

const FLOORS: Partial<Record<keyof RunLimits, number>> = {
  max_turns: 1,
  max_tool_calls: 1,
  max_spend_usd: 0,
};

/**
 * Clamps a requested set of limits to the spec's ranges, filling in the
 * default for anything not supplied. Deliberately clamps rather than
 * rejects (SYSTEM-DESIGN-NEXTJS.md §7: "the tool enforces it") - the agent
 * cannot express a request outside these bounds, so intake never has to
 * bounce a user back with a validation error over a number.
 */
export function clampLimits(requested: Partial<RunLimits>): RunLimits {
  const result = { ...LIMIT_DEFAULTS } as RunLimits;

  for (const key of Object.keys(LIMIT_DEFAULTS) as (keyof RunLimits)[]) {
    const value = requested[key];
    if (value === undefined || Number.isNaN(value)) continue;

    const range = RANGES[key];
    if (range) {
      result[key] = Math.min(range.max, Math.max(range.min, value));
      continue;
    }

    const floor = FLOORS[key];
    result[key] = floor !== undefined ? Math.max(floor, value) : value;
  }

  return result;
}

/**
 * The intake form's only user-facing input is `target_qualified` -
 * everything else is derived here, server-side, never trusted from the
 * client (a hidden field is not the same as an enforced one). Ratios are
 * chosen so `target_qualified = 10` reproduces today's exact
 * `LIMIT_DEFAULTS` (25/30/120/60/$0.50) rather than inventing a new
 * policy - this generalizes the existing default down to smaller
 * requests, it doesn't replace it.
 *
 * `max_spend_usd` is floored at $0.50 regardless of how small the target
 * is, deliberately not scaled down with it: model spend (turns/tokens)
 * is largely independent of how many leads are being asked for - a
 * single Claude Opus session was observed spending $0.49 without
 * producing any leads at all (Task 22's live benchmark pass) - so a
 * tighter floor risks cutting off a small, legitimate request on model
 * cost alone before it can finish.
 */
export function deriveLimitsFromTarget(targetQualifiedRequested: number): RunLimits {
  const range = RANGES.target_qualified!;
  const safeRequested = Number.isFinite(targetQualifiedRequested) ? targetQualifiedRequested : range.min;
  const target = Math.min(range.max, Math.max(range.min, Math.round(safeRequested)));

  const candidateRange = RANGES.candidate_limit!;
  const scrapeRange = RANGES.scrape_limit!;
  const candidate_limit = Math.min(candidateRange.max, Math.max(candidateRange.min, Math.ceil(target * 2.5)));
  const scrape_limit = Math.min(scrapeRange.max, Math.max(scrapeRange.min, Math.ceil(target * 3)));
  const max_tool_calls = Math.max(FLOORS.max_tool_calls!, scrape_limit * 4);
  const max_turns = Math.max(FLOORS.max_turns!, Math.round(max_tool_calls / 2));
  const max_spend_usd = Math.max(0.5, target * 0.08);

  return { target_qualified: target, candidate_limit, scrape_limit, max_turns, max_tool_calls, max_spend_usd };
}

export interface SpendUnitCosts {
  /** Estimated Apify cost per candidate company discovered. */
  perCandidateUsd: number;
  /** Estimated scraper cost per website scraped. Ignored for `crawl4ai`. */
  perScrapeUsd: number;
}

/**
 * A live, pre-commitment spend estimate for the intake form
 * (SYSTEM-DESIGN-NEXTJS.md §17.8: "a live estimated maximum spend that
 * updates as the candidate and scrape counts change, so cost is visible
 * before committing rather than after").
 *
 * Unit costs are supplied by the caller rather than hardcoded here,
 * because the real Apify per-result price is still pending confirmation
 * in the console (see app/docs/provider-findings.md, Task 1 Step 3) - this
 * function must not silently embed a guessed number.
 *
 * `crawl4ai` is self-hosted and free (§4.4), so its scrape cost is always
 * zero regardless of the supplied unit cost.
 */
export function estimateMaxSpendUsd(
  limits: Pick<RunLimits, "candidate_limit" | "scrape_limit"> & { scraper: Scraper },
  unitCosts: SpendUnitCosts,
): number {
  const candidateCost = Math.max(0, limits.candidate_limit) * Math.max(0, unitCosts.perCandidateUsd);
  const scrapeCost =
    limits.scraper === "crawl4ai" ? 0 : Math.max(0, limits.scrape_limit) * Math.max(0, unitCosts.perScrapeUsd);
  return candidateCost + scrapeCost;
}
