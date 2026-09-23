import type { RunLimits } from "./types";

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
 * client (a hidden field is not the same as an enforced one).
 *
 * No dollar-denominated ceiling anywhere in this run - the user's own
 * call, after a real run showed the spend ceiling firing on an
 * over-inflated cost estimate rather than a real problem. Real spend is
 * now bounded structurally instead:
 *
 * - `candidate_limit` is a fixed 40 regardless of `target_qualified` -
 *   not because bigger asks don't need more candidates (they do), but
 *   because this is sized for the worst case (target_qualified's own max
 *   of 10) and matched 1:1 to a single Apify actor dispatch's own cap
 *   (`APIFY_CAP_FIELD_NAME`) - the whole design is "one real discover
 *   call per run, sized generously enough that if it can't find enough
 *   candidates, the objective itself needs refining," not "scale the cap
 *   with how many leads you asked for." A smaller `target_qualified`
 *   doesn't need a smaller candidate pool to choose from.
 * - `scrape_limit`/`max_turns`/`max_tool_calls` are fixed, generous
 *   safety nets, not meant to bind in normal operation against a
 *   candidate pool this size - insurance against a genuine agent
 *   malfunction (e.g. a stuck re-scrape loop), not a routine constraint.
 * - `max_spend_usd` is kept in the type (avoids a schema/UI churn for a
 *   field that's still useful to *record*, just not to *gate on*) but
 *   set high enough here that it can never realistically bind; nothing
 *   in `gate()` or the Apify adapter checks it anymore either.
 */
const FIXED_CANDIDATE_LIMIT = 40;
const FIXED_SCRAPE_LIMIT = 80;
const FIXED_MAX_TOOL_CALLS = 300;
const FIXED_MAX_TURNS = 150;
const EFFECTIVELY_UNLIMITED_SPEND_USD = 999;

export function deriveLimitsFromTarget(targetQualifiedRequested: number): RunLimits {
  const range = RANGES.target_qualified!;
  const safeRequested = Number.isFinite(targetQualifiedRequested) ? targetQualifiedRequested : range.min;
  const target = Math.min(range.max, Math.max(range.min, Math.round(safeRequested)));

  return {
    target_qualified: target,
    candidate_limit: FIXED_CANDIDATE_LIMIT,
    scrape_limit: FIXED_SCRAPE_LIMIT,
    max_turns: FIXED_MAX_TURNS,
    max_tool_calls: FIXED_MAX_TOOL_CALLS,
    max_spend_usd: EFFECTIVELY_UNLIMITED_SPEND_USD,
  };
}

