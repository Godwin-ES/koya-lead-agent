import { ApifyClient, type ActorRun } from "apify-client";
import { withRecording } from "../replay/recorder";
import { hashObjective } from "../../domain/normalize";
import { normalizeDomain } from "../../domain/normalize";
import type { RunLimits, RunCounters } from "../../domain/types";

/**
 * The actor's own field name for its result cap is still unconfirmed -
 * Task 1 Step 3 (choosing an actor and proving its pay-per-result
 * pricing in the Apify Console) is blocked pending that decision. Every
 * real actor family Apify hosts uses *some* input field for this, and
 * "maxItems" is the convention the plan's own test table already assumes
 * and the most common one across Apify's own actors - kept overridable by
 * env so pointing this at the real actor's actual field name (once
 * chosen) is a one-line change, not a rewrite.
 */
const CAP_FIELD_NAME = process.env.APIFY_CAP_FIELD_NAME ?? "maxItems";

/** Placeholder per-result cost, pending real console pricing (same blocker as above). */
const ESTIMATED_COST_PER_RESULT_USD = Number(process.env.APIFY_EST_COST_PER_RESULT_USD ?? "0.01");

const DEFAULT_TIMEOUT_SECS = 90;

export interface DiscoveryCandidate {
  companyName: string;
  companyDomain: string;
  raw: Record<string, unknown>;
}

export interface DiscoverContext {
  limits: Pick<RunLimits, "candidate_limit"> & Partial<Pick<RunLimits, "max_spend_usd">>;
  counters: Pick<RunCounters, "candidates_seen">;
}

export interface DiscoverRequest {
  query: string;
  requested: number;
}

export interface DiscoverCall {
  input: Record<string, unknown>;
}

export interface DiscoverResult extends DiscoverCall {
  candidates: DiscoveryCandidate[];
  itemCount: number;
  cacheHit: boolean;
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
 * The only function that ever talks to Apify. Requires an explicit cap on
 * every call - there is no code path that can dispatch without one, which
 * is what actually makes "the agent must not decide the lead count"
 * (PRD) hold at the implementation level, not just by convention.
 *
 * Exported only so the "refuses to dispatch with no cap" test can assert
 * on it directly, per the plan's own test snippet - every real caller
 * must go through `discover()`, never this.
 */
export async function dispatchRaw(args: RawDispatchArgs): Promise<RawDispatchResult> {
  const cap = args.input[CAP_FIELD_NAME];
  if (typeof cap !== "number" || cap <= 0) {
    throw new Error(`cap required: input.${CAP_FIELD_NAME} must be a positive number, got ${String(cap)}`);
  }

  const actorId = process.env.APIFY_ACTOR_ID;
  if (!actorId) {
    throw new Error(
      "APIFY_ACTOR_ID is not set - actor selection is still pending (app/docs/provider-findings.md, Task 1 Step 3).",
    );
  }

  const client = getClient();
  const timeoutSecs = args.timeoutSecs ?? DEFAULT_TIMEOUT_SECS;

  const run = await client.actor(actorId).call(args.input, { waitSecs: timeoutSecs, timeout: timeoutSecs * 1000 });

  if (run.status !== "SUCCEEDED") {
    // Apify actor runs left in a non-terminal or failed state should not
    // be trusted for results, and must not be left spending - abort
    // explicitly rather than assuming .call()'s own wait handled it.
    await client.run(run.id).abort().catch(() => undefined);
    throw new Error(`Apify actor run did not succeed (status: ${run.status})`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return { run: { defaultDatasetId: run.defaultDatasetId }, items: items as Record<string, unknown>[] };
}

/**
 * Extracts a usable candidate from a raw Apify item. Field names confirmed
 * against a real 2-result run of rp_openpro.ai/b2b-url-finder (Task 10
 * Step 3, BUILD-NOTES-NEXTJS.md): items carry `domain`, `url`, and
 * `pageTitle` - there is no `name` field. The original guess (`item.name`)
 * would have silently dropped every real result, confirmed by that same
 * run: 2/2 items failed to parse before this fix.
 */
function toCandidate(item: Record<string, unknown>): DiscoveryCandidate | null {
  const rawDomain = typeof item.domain === "string" ? item.domain.trim() : "";
  if (!rawDomain) return null;

  const domain = normalizeDomain(rawDomain);
  if (!domain) return null;

  const pageTitle = typeof item.pageTitle === "string" ? item.pageTitle.trim() : "";
  const companyName = pageTitle || domain;

  return { companyName, companyDomain: domain, raw: item };
}

// A per-process, best-effort run-level spend tracker. The authoritative
// record is cost_ledger (Task 5); this only prevents obviously wasteful
// back-to-back dispatches within one process without a round trip - real
// enforcement happens via the run-level and cost_ledger checks below.
const spentByContext = new Map<string, number>();

export function __resetSpendCacheForTests(): void {
  spentByContext.clear();
}

export interface DiscoverOptions {
  /** Test-only: bypass the computed cache key and use this fixture directly. */
  fixtureKeyOverride?: string;
  /** Test-only: replace the network dispatch with a spy/stub. */
  dispatchOverride?: (args: RawDispatchArgs) => Promise<RawDispatchResult>;
}

/**
 * The safe, budget-aware entry point every caller (Task 12's
 * discover_companies tool) actually uses. Clamps the requested count to
 * the run's remaining candidate budget, truncates the result to that same
 * cap regardless of how many items the actor actually returns (it does
 * not reliably respect the cap field itself - confirmed live), reads the
 * replay cache before ever dispatching, and reports the estimated cost of
 * whatever it returns. No dollar-denominated ceiling gates this call
 * anymore - real spend is bounded by candidate_limit itself, not a
 * separate spend check.
 *
 * Deliberately does not write to `cost_ledger` or `discovery_cache`
 * itself, and does not check the day-level cohort-wide spend ceiling -
 * both need a Supabase client this module doesn't take, matching Task 7's
 * model adapters (`cheap-model.ts`'s own comment: "callers need usage to
 * write the cost_ledger row themselves"). Task 12's tool wrapper, which
 * already holds that client for tool_calls logging, is where those two
 * belong; this function's job is only to make a correctly-capped Apify
 * call and to report what it cost, not to own persistence.
 */
export async function discover(
  context: DiscoverContext,
  request: DiscoverRequest,
  options: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const remaining = Math.max(0, context.limits.candidate_limit - (context.counters.candidates_seen ?? 0));
  const cap = Math.max(0, Math.min(request.requested, remaining));

  // The chosen actor (rp_openpro.ai/b2b-url-finder) takes an array of
  // search keywords, not a single query string - confirmed against its
  // real input schema (Task 10 Step 3, BUILD-NOTES-NEXTJS.md).
  const input: Record<string, unknown> = { keywords: [request.query], [CAP_FIELD_NAME]: cap };

  if (cap === 0) {
    return { input, candidates: [], itemCount: 0, cacheHit: false, estimatedCostUsd: 0 };
  }

  const fixtureKey = options.fixtureKeyOverride ?? `apify:discover:${hashObjective(JSON.stringify(input))}`;

  const dispatch = options.dispatchOverride ?? dispatchRaw;
  const raw = await withRecording(fixtureKey, () => dispatch({ input }));

  // The actor doesn't reliably respect the cap field we send it -
  // confirmed live: a call capped at 13 came back with 18 real items,
  // which then let candidates_seen blow past candidate_limit on a
  // single call. Truncating here, regardless of what the actor actually
  // returns, is what makes "the tool enforces it" true rather than
  // trusting a third party to honor an input field.
  const items = raw.items.slice(0, cap);
  const candidates = items.map(toCandidate).filter((c): c is DiscoveryCandidate => c !== null);
  const estimatedCostUsd = items.length * ESTIMATED_COST_PER_RESULT_USD;

  return {
    input,
    candidates,
    itemCount: items.length,
    cacheHit: false,
    estimatedCostUsd,
  };
}
