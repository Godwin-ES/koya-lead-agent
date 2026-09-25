import type { SupabaseClient } from "@supabase/supabase-js";
import { getRunById } from "@core/db/runs";

/**
 * Why a running run should stop at its next safe point (between steps,
 * never inside one). Checked by both runners after every tool call, and by
 * the Gemini runner also before each model call and after each reply.
 * - `shutdown`: the worker itself is stopping (SIGTERM) - the run is requeued.
 * - `pause`: the user pressed Pause - the run becomes `paused`.
 * - `user_cancel`: the user pressed Cancel - the run is already `cancelled`;
 *   before this check existed the agent kept running (and spending) after
 *   a cancel, and could even overwrite it with `completed` when it finalized.
 */
export type StopKind = "shutdown" | "pause" | "user_cancel";

export async function readStopRequest(supabase: SupabaseClient, runId: string, shouldStop?: () => boolean): Promise<StopKind | null> {
  if (shouldStop?.()) return "shutdown";
  const row = await getRunById(supabase, runId);
  if (!row || row.status === "cancelled") return "user_cancel";
  if (row.pause_requested_at) return "pause";
  return null;
}

/** Thrown from inside a wait (e.g. a rate-limit retry sleep) to stop the run without finishing the wait. */
export class RunStopRequested extends Error {
  constructor(public readonly kind: StopKind) {
    super(`run stop requested: ${kind}`);
    this.name = "RunStopRequested";
  }
}

/** A sleep that gives up early - by throwing RunStopRequested - if a stop is requested while waiting. */
export function interruptibleSleep(check: () => Promise<StopKind | null>, pollMs = 2_000) {
  return async (ms: number): Promise<void> => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, until - Date.now())));
      const stop = await check();
      if (stop) throw new RunStopRequested(stop);
    }
  };
}
