import type { RunLimits } from "./types";
import { candidatesPerDiscoverCall } from "./discovery";

/** The most searches a run can ever be given, including extensions. */
export const MAX_SEARCHES = 6;

/** SYSTEM-DESIGN-NEXTJS.md §7's "Intake and Visible Defaults" table. */
export const LIMIT_DEFAULTS: RunLimits = {
  target_qualified: 10,
  max_discover_attempts: 3,
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
  // Room for up to six searches of 25 - three at creation, more via "Continue with more budget".
  candidate_limit: { min: 1, max: 150 },
  scrape_limit: { min: 1, max: 300 },
  max_discover_attempts: { min: 1, max: MAX_SEARCHES },
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
 * client (a hidden field is not the same as an enforced one).
 *
 * No dollar-denominated ceiling anywhere - spend is bounded structurally:
 *
 * - `candidate_limit` = MAX_DISCOVER_ATTEMPTS x the per-call size
 *   (candidatesPerDiscoverCall: 2x target, within [10, 25]), so every one
 *   of the three attempts - including paging deeper through a query that
 *   works - can return a full page. Worst case at target 10: 75 results,
 *   ~$0.30 at HarvestAPI's $0.004/result.
 * - `scrape_limit` = 2 pages per candidate (homepage plus a pricing or
 *   product page); scrape_site also enforces the 2-page limit per company.
 * - `max_turns`/`max_tool_calls` are generous circuit breakers, not meant
 *   to bind in normal operation.
 * - `max_spend_usd` stays in the type for recording only; nothing gates on it.
 */
const DISCOVER_ATTEMPTS = 3;
const SCRAPE_PAGES_PER_CANDIDATE = 2;
const FIXED_MAX_TOOL_CALLS = 400;
const FIXED_MAX_TURNS = 150;
const EFFECTIVELY_UNLIMITED_SPEND_USD = 999;

export function deriveLimitsFromTarget(targetQualifiedRequested: number): RunLimits {
  const range = RANGES.target_qualified!;
  const safeRequested = Number.isFinite(targetQualifiedRequested) ? targetQualifiedRequested : range.min;
  const target = Math.min(range.max, Math.max(range.min, Math.round(safeRequested)));

  const candidateLimit = DISCOVER_ATTEMPTS * candidatesPerDiscoverCall(target);

  return {
    target_qualified: target,
    max_discover_attempts: DISCOVER_ATTEMPTS,
    candidate_limit: candidateLimit,
    scrape_limit: candidateLimit * SCRAPE_PAGES_PER_CANDIDATE,
    max_turns: FIXED_MAX_TURNS,
    max_tool_calls: FIXED_MAX_TOOL_CALLS,
    max_spend_usd: EFFECTIVELY_UNLIMITED_SPEND_USD,
  };
}


export type LimitReachedKind = "searches" | "candidates" | "scrapes" | "turns" | "tool_calls" | null;

/**
 * "Continue with more budget": the run's limits with `extraSearches` more
 * LinkedIn searches, each with its own candidates and scrape pages. Whatever
 * actually stopped the run (scrape pages, candidates, turns, tool calls)
 * also gets headroom - otherwise the continued run would stop again at once.
 */
export function extendLimits(limits: RunLimits, extraSearches: number, limitReached: LimitReachedKind): RunLimits {
  const searches = limits.max_discover_attempts ?? DISCOVER_ATTEMPTS;
  const added = Math.max(0, Math.min(Math.round(extraSearches), MAX_SEARCHES - searches));
  const perSearch = candidatesPerDiscoverCall(limits.target_qualified);
  return clampLimits({
    ...limits,
    max_discover_attempts: searches + added,
    candidate_limit: limits.candidate_limit + (added + (limitReached === "candidates" ? 1 : 0)) * perSearch,
    scrape_limit: limits.scrape_limit + (added + (limitReached === "scrapes" ? 1 : 0)) * perSearch * SCRAPE_PAGES_PER_CANDIDATE,
    max_turns: limits.max_turns + (limitReached === "turns" ? 75 : added * 25),
    max_tool_calls: limits.max_tool_calls + (limitReached === "tool_calls" ? 150 : added * 60),
  });
}

/** How many more searches a run can still be given. */
export function searchesLeftToAdd(limits: Partial<RunLimits>): number {
  return Math.max(0, MAX_SEARCHES - (limits.max_discover_attempts ?? DISCOVER_ATTEMPTS));
}
