"use server";

import { createClient } from "@/lib/supabase/server";
import { insertRun } from "@core/db/runs";
import { LIMIT_DEFAULTS } from "@core/domain/limits";
import type { FailureMode } from "@core/providers/failure-injection";

export interface LaunchScenarioResult {
  runId?: string;
  error?: string;
}

/**
 * Task 20 Step 3: "The toggles plus one-click launches of the PRD
 * scenarios, all in replay mode. This is what makes the Loom's failure
 * demo a button press." Each mode needs a fixture set that actually
 * reaches the tool call it targets before the injected failure fires -
 * mapped here rather than left for the caller to guess.
 */
const FIXTURE_SET_FOR_MODE: Record<FailureMode, string> = {
  apify_auth_error: "specific-objective",
  apify_empty_result: "specific-objective",
  sidecar_down: "failure-injection-scrape",
  model_429: "specific-objective",
  invalid_tool_input: "specific-objective",
  worker_kill: "specific-objective",
};

export async function launchFailureScenario(mode: FailureMode): Promise<LaunchScenarioResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const run = await insertRun(supabase, {
    user_id: user.id,
    objective_raw: `[Test console] ${mode} scenario`,
    status: "queued",
    runner: "gemini",
    scraper: "crawl4ai",
    limits: LIMIT_DEFAULTS,
    fixture_set: FIXTURE_SET_FOR_MODE[mode],
    queued_at: new Date().toISOString(),
  });

  // insertRun doesn't take injected_failure (it's a demo-only field, not
  // part of the normal create-run flow) - set it directly.
  await supabase.from("runs").update({ injected_failure: mode }).eq("id", run.id);

  return { runId: run.id };
}
