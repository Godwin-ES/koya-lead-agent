import { ApifyClient, type ActorRun } from "apify-client";
import { withRecording } from "../replay/recorder";
import { hashObjective } from "../../domain/normalize";
import { normalizeHarvestItem, type NormalizedCandidate } from "../../domain/discovery";
import type { RunLimits, RunCounters } from "../../domain/types";
import { classifyHttpFailure, retryTemporaryOnce, RunFailure } from "../../domain/failure";

/**
 * harvestapi/linkedin-company-search - a LinkedIn company database, chosen
 * after the previous actor (a generic Bing/DuckDuckGo wrapper) returned
 * TV series for "Series A" queries. The input shape below is this actor's
 * own, confirmed live, so the id is fixed here rather than configurable.
 */
export const ACTOR_ID = "harvestapi/linkedin-company-search";

/** Real PAY_PER_EVENT pricing from the actor's own listing (FREE tier): one-time run start + per full-company result. */
export const COST_PER_RUN_START_USD = 0.001;
export const COST_PER_RESULT_USD = 0.004;

const DEFAULT_TIMEOUT_SECS = 90;

export interface DiscoverContext {
  limits: Pick<RunLimits, "candidate_limit">;
  counters: Pick<RunCounters, "candidates_seen">;
}

export interface DiscoverRequest {
  industryIds: string[];
  /** Null searches on the structured filters alone. */
  keyword: string | null;
  locations: string[];
  companySize: string[];
  page: number;
  requested: number;
}

export interface DiscoverResult {
  input: Record<string, unknown>;
  candidates: NormalizedCandidate[];
  /** Raw items the actor returned (and billed), including any that failed to normalize. */
  itemCount: number;
  /** LinkedIn's own match count for this search, across all pages. */
  totalResultCount: number;
  estimatedCostUsd: number;
}

interface RawDispatchArgs {
  input: Record<string, unknown>;
  timeoutSecs?: number;
}

interface RawDispatchResult {
  run: Pick<ActorRun, "defaultDatasetId">;
  items: Record<string, unknown>[];
}

let cachedClient: ApifyClient | null = null;

function getClient(): ApifyClient {
  if (!cachedClient) cachedClient = new ApifyClient({ token: process.env.APIFY_API_KEY });
  return cachedClient;
}

/**
 * The only function that talks to Apify. Refuses to dispatch without a
 * positive `maxItems` - the actor honors it exactly (every live probe
 * returned exactly the requested count), so the cap is enforced where the
 * spend happens, not by discarding results afterwards.
 *
 * Exported only for its own "refuses to dispatch with no cap" test.
 */
export async function dispatchRaw(args: RawDispatchArgs): Promise<RawDispatchResult> {
  const cap = args.input.maxItems;
  if (typeof cap !== "number" || cap <= 0) {
    throw new Error(`cap required: input.maxItems must be a positive number, got ${String(cap)}`);
  }

  const client = getClient();
  const timeoutSecs = args.timeoutSecs ?? DEFAULT_TIMEOUT_SECS;
  // One retry for a temporary failure (network, rate limit, Apify 5xx, a
  // failed or timed-out actor run); a bad token or used-up plan stops the run.
  return retryTemporaryOnce(async () => {
    try {
      const run = await client.actor(ACTOR_ID).call(args.input, { waitSecs: timeoutSecs, timeout: timeoutSecs * 1000, log: null });

      if (run.status !== "SUCCEEDED") {
        // A run left non-terminal is a run still spending - abort explicitly.
        await client.run(run.id).abort().catch(() => undefined);
        throw new RunFailure("temporary", "apify", `The Apify search run didn't finish (status: ${run.status}).`);
      }

      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      return { run: { defaultDatasetId: run.defaultDatasetId }, items: items as Record<string, unknown>[] };
    } catch (err) {
      if (err instanceof RunFailure) throw err;
      throw classifyApifyError(err);
    }
  });
}

/** apify-client errors carry statusCode and a type like "user-or-token-not-found"; none at all means no response. */
function classifyApifyError(err: unknown): RunFailure {
  const e = err as { statusCode?: number; type?: string; message?: string };
  const detail = [e.type, e.message].filter(Boolean).join(": ");
  if (typeof e.statusCode === "number") return classifyHttpFailure("apify", e.statusCode, detail);
  // No status: temporary only if it's really the network, not a bug of ours.
  if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|timed? ?out/i.test(detail)) return classifyHttpFailure("apify", null, detail);
  return new RunFailure("bug", "apify", `The Apify search failed: ${detail || "unknown error"}`);
}

export interface DiscoverOptions {
  /** Test-only: bypass the computed cache key and use this fixture directly. */
  fixtureKeyOverride?: string;
  /** Test-only: replace the network dispatch with a spy/stub. */
  dispatchOverride?: (args: RawDispatchArgs) => Promise<RawDispatchResult>;
}

export function buildActorInput(request: DiscoverRequest, cap: number): Record<string, unknown> {
  const input: Record<string, unknown> = {
    scraperMode: "full",
    maxItems: cap,
    industryIds: request.industryIds,
    locations: request.locations,
    startPage: request.page,
  };
  if (request.keyword) input.searchQuery = request.keyword;
  if (request.companySize.length) input.companySize = request.companySize;
  return input;
}

/**
 * Clamps the request to the run's remaining candidate budget, reads the
 * replay cache before dispatching, and reports the real cost of what the
 * actor actually returned. Persistence (cost_ledger, discovery_cache) is
 * the tool handler's job - it holds the Supabase client.
 */
export async function discover(context: DiscoverContext, request: DiscoverRequest, options: DiscoverOptions = {}): Promise<DiscoverResult> {
  const remaining = Math.max(0, context.limits.candidate_limit - (context.counters.candidates_seen ?? 0));
  const cap = Math.max(0, Math.min(request.requested, remaining));
  const input = buildActorInput(request, cap);

  if (cap === 0) {
    return { input, candidates: [], itemCount: 0, totalResultCount: 0, estimatedCostUsd: 0 };
  }

  const fixtureKey = options.fixtureKeyOverride ?? `apify:discover:${hashObjective(JSON.stringify(input))}`;
  const dispatch = options.dispatchOverride ?? dispatchRaw;
  // Live, page 2 of a search whose page 1 had 50 profiles came back with
  // "Found 0 profiles on the page" - and the identical input returned 50 a
  // few minutes later. An empty later page is a LinkedIn/actor glitch far
  // more often than a real end of results, so it gets one retry.
  let runStarts = 1;
  const raw = await withRecording(fixtureKey, async () => {
    const first = await dispatch({ input });
    if (first.items.length > 0 || request.page <= 1) return first;
    runStarts += 1;
    return dispatch({ input });
  });

  const meta = (raw.items[0]?._meta ?? {}) as { pagination?: { totalResultCount?: unknown } };
  const totalResultCount = typeof meta.pagination?.totalResultCount === "number" ? meta.pagination.totalResultCount : raw.items.length;

  return {
    input,
    candidates: raw.items.map(normalizeHarvestItem).filter((c): c is NormalizedCandidate => c !== null),
    itemCount: raw.items.length,
    totalResultCount,
    estimatedCostUsd: runStarts * COST_PER_RUN_START_USD + raw.items.length * COST_PER_RESULT_USD,
  };
}
