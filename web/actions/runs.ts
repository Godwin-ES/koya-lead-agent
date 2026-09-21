"use server";

import { createClient } from "@/lib/supabase/server";
import { insertRun, listRunsForUser } from "@core/db/runs";
import { validateObjective } from "@core/validation/objective";
import { clampLimits } from "@core/domain/limits";
import type { RunLimits, Runner, Scraper } from "@core/domain/types";
import type { RunRow } from "@core/db/row-types";

export interface CreateRunInput {
  objectiveText: string;
  limits: Partial<RunLimits>;
  runner: Runner;
  model?: string;
  scraper: Scraper;
  /** Whether the user dismissed a validation flag before submitting. */
  dismissed: boolean;
  /** Generated once by ActionButton, stable across retries of this one intent. */
  idempotencyKey: string;
}

export interface CreateRunResult {
  runId?: string;
  error?: string;
}

/**
 * SYSTEM-DESIGN-NEXTJS.md §9 Step 3: re-validates regardless of what the
 * client reported (a client-side check is UX, never the enforcement -
 * §7.1), refuses a confidently unsafe objective server-side, persists
 * the verdict and any dismissal onto the run itself, copies every limit
 * onto the row (clamped, so the agent can never receive an out-of-range
 * request), and is idempotent on the client-generated key.
 */
export async function createRun(input: CreateRunInput): Promise<CreateRunResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in." };
  }

  const { data: existing } = await supabase
    .from("runs")
    .select("id")
    .eq("user_id", user.id)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle<Pick<RunRow, "id">>();
  if (existing) {
    return { runId: existing.id };
  }

  const validation = await validateObjective(supabase, input.objectiveText, user.id);
  if (validation.blocking) {
    return { error: validation.reason || "This objective asks for something outside this tool's scope." };
  }

  const limits = clampLimits(input.limits);

  const run = await insertRun(supabase, {
    user_id: user.id,
    objective_raw: input.objectiveText,
    status: "queued",
    runner: input.runner,
    model: input.model,
    scraper: input.scraper,
    limits,
    validation_verdict: validation.verdict,
    validation_reason: validation.reason,
    validation_confidence: validation.confidence ?? undefined,
    validation_missing_criteria: validation.missingCriteria,
    validation_dismissed_at: input.dismissed ? new Date().toISOString() : undefined,
    idempotency_key: input.idempotencyKey,
    queued_at: new Date().toISOString(),
  });

  return { runId: run.id };
}

export async function listMyRuns() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  return listRunsForUser(supabase, user.id);
}
