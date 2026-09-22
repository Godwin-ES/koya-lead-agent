import type { SupabaseClient } from "@supabase/supabase-js";
import { claimNextRun, heartbeat, updateRun } from "@core/db/runs";
import { sumCostForRun } from "@core/db/cost";
import { recordSystemError } from "@core/db/system-errors";
import { isInjected } from "@core/providers/failure-injection";
import type { RunLimits, Runner, Scraper } from "@core/domain/types";
import type { ToolRunState } from "@core/tools/log";
import { runGeminiAgent, type GeminiStopReason } from "./runners/gemini";
import { runAgentSdk, type AgentSdkStopReason } from "./runners/agent-sdk";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

function resolveRunner(row: { runner: Runner | null }): Runner {
  return row.runner ?? (process.env.RUNNER_DEFAULT === "agent-sdk" ? "agent-sdk" : "gemini");
}

function resolveScraper(row: { scraper: Scraper | null }): Scraper {
  return row.scraper ?? (process.env.SCRAPER_DEFAULT === "firecrawl" ? "firecrawl" : "crawl4ai");
}

export interface ClaimAndProcessOptions {
  heartbeatIntervalMs?: number;
  /** Passed straight through to the runner - see RunGeminiAgentParams.shouldStop for the exact contract. */
  shouldStop?: () => boolean;
}

export interface ClaimAndProcessResult {
  claimed: boolean;
  runId?: string;
  stopReason?: GeminiStopReason | AgentSdkStopReason;
}

/**
 * Claims at most one queued run and runs it to a stopping point - never
 * more than one at a time per worker (`claim_next_run`'s `FOR UPDATE SKIP
 * LOCKED`, Task 5, is what makes two workers racing for the same run
 * safe). Returns `{ claimed: false }` immediately when nothing is
 * queued, which is what the poll loop uses to decide whether to wait
 * before trying again.
 */
export async function claimAndProcessOne(
  supabase: SupabaseClient,
  workerId: string,
  options: ClaimAndProcessOptions = {},
): Promise<ClaimAndProcessResult> {
  const row = await claimNextRun(supabase, workerId);
  if (!row) return { claimed: false };

  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimer = setInterval(() => {
    heartbeat(supabase, row.id, workerId).catch((err) => console.error(`heartbeat failed for run ${row.id}:`, err));
  }, heartbeatIntervalMs);

  try {
    const runState: ToolRunState & {
      objectiveRaw: string;
      clarificationAnswer?: string | null;
      fixtureSet?: string | null;
    } = {
      id: row.id,
      icp: row.icp,
      limits: row.limits as RunLimits,
      counters: { qualified_count: 0, ...(row.counters as Record<string, number>) },
      clarificationCount: row.clarification_count,
      spentUsd: await sumCostForRun(supabase, row.id),
      scraper: resolveScraper(row),
      objectiveRaw: row.objective_raw,
      clarificationAnswer: row.clarification_answer,
      fixtureSet: row.fixture_set,
      injectedFailure: row.injected_failure,
    };

    // Task 20 failure injection (§13: "Worker crash / redeploy
    // mid-run"). A demo/test process can't literally call
    // `process.exit()` here without killing whatever is running this
    // code (including the test suite that verifies this path) - this
    // simulates the *outcome* a real crash produces (the run can't
    // continue, fails loudly with a system_errors row) rather than the
    // OS-level kill itself. The actual "heartbeat expires, the run gets
    // reclaimed and requeued" recovery path already has real test
    // coverage (tests/integration/rpc/reclaim.test.ts, Task 5), driven
    // by directly manipulating heartbeat_at rather than waiting out a
    // real 90-second staleness window.
    if (isInjected("worker_kill", row.injected_failure)) {
      throw new Error("Simulated worker crash mid-run (failure injection: worker_kill).");
    }

    const runner = resolveRunner(row);
    const result =
      runner === "agent-sdk"
        ? await runAgentSdk({ supabase, run: runState, model: row.model ?? undefined, shouldStop: options.shouldStop })
        : await runGeminiAgent({ supabase, run: runState, model: row.model ?? undefined, shouldStop: options.shouldStop });

    if (result.stopReason === "cancelled") {
      // Graceful SIGTERM (Task 16): the current tool call already
      // finished (both runners only ever check shouldStop() after one
      // commits) - requeue rather than orphan the run mid-attempt.
      await updateRun(supabase, row.id, {
        status: "queued",
        worker_id: null,
        heartbeat_at: null,
        queued_at: new Date().toISOString(),
      });
    } else if (result.stopReason === "clarification_requested") {
      await updateRun(supabase, row.id, { status: "awaiting_input" });
    }
    // "finalized" and "max_turns" already transitioned the run via
    // finalize_run's own RPC (completed/partial) - nothing more here.

    return { claimed: true, runId: row.id, stopReason: result.stopReason };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`run ${row.id} failed:`, err);
    await updateRun(supabase, row.id, { status: "failed", failure_reason: message }).catch((updateErr) =>
      console.error(`failed to mark run ${row.id} failed:`, updateErr),
    );
    // SYSTEM-DESIGN-NEXTJS.md §13: "Every failure writes a system_errors
    // row" - this catch block is the one place every unrecoverable run
    // failure already passes through, regardless of which stage or
    // provider caused it.
    await recordSystemError(supabase, { runId: row.id, phase: "run", message }).catch((recordErr) =>
      console.error(`failed to record system_error for run ${row.id}:`, recordErr),
    );
    return { claimed: true, runId: row.id };
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export interface BootCredentialCheckers {
  /** Injectable for tests - the real one calls the Apify API. */
  checkApifyAccount?: (token: string) => Promise<string>;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to start the worker - see .env.example.`);
  return value;
}

async function defaultCheckApifyAccount(token: string): Promise<string> {
  const { ApifyClient } = await import("apify-client");
  const client = new ApifyClient({ token });
  const user = await client.user().get();
  return user.id ?? user.username;
}

/**
 * Boot-time validation (Task 16 Step 2): refuses to start with
 * misconfigured or mismatched credentials rather than fail confusingly
 * mid-run. The Apify account check specifically guards against a
 * personal-account token billing runs outside the shared cohort budget
 * (PRD "Apify Usage Limits") - only enforced when
 * `APIFY_EXPECTED_ACCOUNT_ID` is set, since the team account id isn't
 * knowable until Task 1 Step 3's console decision is made.
 */
export async function validateBootCredentials(checkers: BootCredentialCheckers = {}): Promise<void> {
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const apifyToken = requiredEnv("APIFY_API_KEY");
  requiredEnv("APIFY_ACTOR_ID");

  const expectedAccountId = process.env.APIFY_EXPECTED_ACCOUNT_ID;
  if (expectedAccountId) {
    const checkApifyAccount = checkers.checkApifyAccount ?? defaultCheckApifyAccount;
    const actualAccountId = await checkApifyAccount(apifyToken);
    if (actualAccountId !== expectedAccountId) {
      throw new Error(
        `Apify token belongs to account "${actualAccountId}", expected the team account "${expectedAccountId}" - refusing to start (a personal-account token would bill outside the shared cohort budget, PRD "Apify Usage Limits").`,
      );
    }
  }

  if (process.env.RUNNER_DEFAULT === "agent-sdk") {
    requiredEnv("ANTHROPIC_API_KEY");
  } else {
    requiredEnv("GOOGLE_AI_API_KEY");
  }
}

export interface RunClaimLoopOptions {
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  /** Stops the loop from claiming further runs; the run in flight (if any) still completes or gracefully cancels via its own shouldStop. */
  isShuttingDown: () => boolean;
}

/**
 * The poll loop itself: claims and fully processes one run at a time,
 * waiting `pollIntervalMs` between attempts when nothing is queued.
 * Exits as soon as `isShuttingDown()` is true and no run is in flight.
 */
export async function runClaimLoop(supabase: SupabaseClient, workerId: string, options: RunClaimLoopOptions): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 3000;

  while (!options.isShuttingDown()) {
    const result = await claimAndProcessOne(supabase, workerId, {
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      shouldStop: options.isShuttingDown,
    });

    if (!result.claimed) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}
