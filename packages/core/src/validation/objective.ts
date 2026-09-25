import type { SupabaseClient } from "@supabase/supabase-js";
import { stage1, type Stage1Code } from "./stage1";
import { classifyObjective } from "./classifier";
import { hashObjective } from "../domain/normalize";
import type { MissingCriterion, RunValidationVerdict } from "../schemas/validation";
import { cheapModel, isProduction } from "../domain/environment";
import { objectiveCheckDownMessage, sendDiscord } from "../notify/discord";
import { isReplayMode } from "../providers/replay/recorder";

/** Below this, a confident-sounding verdict still only whispers (§7.2: "Low classifier confidence never blocks"). */
const CONFIDENCE_FLOOR = 0.6;

export interface ValidationResult {
  verdict: RunValidationVerdict;
  confidence: number | null;
  reason: string;
  missingCriteria: MissingCriterion[];
  suggestedRewrite: string | null;
  /** Everything except out_of_scope_unsafe (§7.2's table). */
  dismissible: boolean;
  /** True only for a confident out_of_scope_unsafe verdict - submission stays disabled. */
  blocking: boolean;
  severity: "none" | "advisory" | "flag";
  cached: boolean;
}

/**
 * Stage 1 codes map onto the same verdict vocabulary Stage 2 produces, so
 * the UI (Task 9) renders both through one path
 * (packages/core/src/domain/status.ts's VALIDATION_VERDICT registry)
 * rather than needing a parallel set of stage1-specific messages.
 */
function stage1CodeToVerdict(code: Stage1Code): { verdict: RunValidationVerdict; reason: string } {
  switch (code) {
    case "too_short":
      return { verdict: "vague", reason: "The objective is too short to search on." };
    case "too_long":
      return { verdict: "vague", reason: "The objective is too long - try narrowing it to the essentials." };
    case "no_alpha":
      return { verdict: "incoherent", reason: "The objective has no readable words." };
    case "bare_url":
      return { verdict: "not_a_request", reason: "A URL or email address alone isn't a targeting instruction." };
    case "gibberish":
      return { verdict: "incoherent", reason: "The objective doesn't read as coherent text." };
  }
}

/** At most one #alerts message per server instance every 10 minutes, however many checks fail. */
const CHECK_DOWN_ALERT_INTERVAL_MS = 10 * 60_000;
let lastCheckDownAlertAt = 0;

async function alertObjectiveCheckDown(): Promise<void> {
  if (isReplayMode() || Date.now() - lastCheckDownAlertAt < CHECK_DOWN_ALERT_INTERVAL_MS) return;
  lastCheckDownAlertAt = Date.now();
  await sendDiscord("alerts", objectiveCheckDownMessage());
}

export const UNAVAILABLE_REASON = "The objective check is unavailable right now - try again in a minute. A run can't start until its objective has been checked.";

/** A blocking result for when the check itself couldn't run - the same shape the browser shows if the request fails. */
export function unavailableResult(): ValidationResult {
  return {
    verdict: "unavailable",
    confidence: null,
    reason: UNAVAILABLE_REASON,
    missingCriteria: [],
    suggestedRewrite: null,
    cached: false,
    dismissible: false,
    blocking: true,
    severity: "flag",
  };
}

function buildResult(args: {
  verdict: RunValidationVerdict;
  confidence: number | null;
  reason: string;
  missingCriteria: MissingCriterion[];
  suggestedRewrite: string | null;
  cached: boolean;
}): ValidationResult {
  const { verdict, confidence } = args;
  const isUnsafe = verdict === "out_of_scope_unsafe";
  const lowConfidence = confidence !== null && confidence < CONFIDENCE_FLOOR;

  let severity: ValidationResult["severity"];
  if (verdict === "valid") severity = "none";
  else if (verdict === "unavailable" || lowConfidence) severity = "advisory";
  else severity = "flag";

  return {
    ...args,
    dismissible: !isUnsafe,
    // A low-confidence classifier never blocks, even for out_of_scope_unsafe -
    // an unsure model doesn't get to make the one non-dismissible call.
    blocking: isUnsafe && !lowConfidence,
    severity,
  };
}

async function persist(
  supabase: SupabaseClient,
  userId: string,
  objectiveRaw: string,
  result: ValidationResult,
): Promise<void> {
  const model = isProduction() || process.env.RUNNER_DEFAULT === "agent-sdk" ? cheapModel() : process.env.GEMINI_MODEL;

  await supabase.from("objective_validations").upsert(
    {
      user_id: userId,
      objective_hash: hashObjective(objectiveRaw),
      objective_raw: objectiveRaw,
      verdict: result.verdict,
      confidence: result.confidence,
      reason: result.reason,
      missing_criteria: result.missingCriteria,
      suggested_rewrite: result.suggestedRewrite,
      model,
    },
    { onConflict: "user_id,objective_hash" },
  );
}

/**
 * SYSTEM-DESIGN-NEXTJS.md §7.1/§7.2: the objective validation gate. Runs
 * in a Next.js server action (web/actions/validation.ts), before a run
 * or a worker even exists - hence the SupabaseClient parameter, which
 * the plan's literal `validateObjective(text, userId)` sketch omits but
 * which the caching and persistence below genuinely need (Task 5's
 * repos take a client the same way, for the same reason).
 */
export async function validateObjective(
  supabase: SupabaseClient,
  text: string,
  userId: string,
): Promise<ValidationResult> {
  const s1 = stage1(text);
  if (!s1.ok) {
    const { verdict, reason } = stage1CodeToVerdict(s1.code);
    const result = buildResult({
      verdict,
      confidence: null,
      reason,
      missingCriteria: [],
      suggestedRewrite: null,
      cached: false,
    });
    await persist(supabase, userId, text, result);
    return result;
  }

  const objectiveHash = hashObjective(text);

  // Excludes "unavailable" rows deliberately - a real bug, found live
  // against production Supabase: a transient classifier outage on one
  // check got upserted here (below, in the catch block) same as any real
  // verdict, and every later check of the identical text then hit that
  // cached row first and never called the classifier again - permanently
  // "stuck" on one outage that had long since cleared. An "unavailable"
  // verdict isn't a real judgment about the objective, so it must never
  // be served as if it were one; the classifier gets a fresh attempt
  // every time until it actually succeeds (or fails again) for real.
  const { data: cachedRow } = await supabase
    .from("objective_validations")
    .select()
    .eq("user_id", userId)
    .eq("objective_hash", objectiveHash)
    .neq("verdict", "unavailable")
    .maybeSingle();

  if (cachedRow) {
    return buildResult({
      verdict: cachedRow.verdict,
      confidence: cachedRow.confidence,
      reason: cachedRow.reason ?? "",
      missingCriteria: cachedRow.missing_criteria ?? [],
      suggestedRewrite: cachedRow.suggested_rewrite ?? null,
      cached: true,
    });
  }

  let classifierVerdict;
  try {
    // One retry for a momentary glitch before calling the check unavailable.
    classifierVerdict = await classifyObjective(text).catch(() => classifyObjective(text));
  } catch {
    // Decision changed before deployment: an outage now blocks the run
    // (it used to proceed without validation). No run starts on an
    // objective nobody checked; checking again once it's back is one
    // click. Persisting the attempt is best-effort and never cached.
    const result = unavailableResult();
    await persist(supabase, userId, text, result).catch(() => undefined);
    await alertObjectiveCheckDown();
    return result;
  }

  const result = buildResult({
    verdict: classifierVerdict.verdict,
    confidence: classifierVerdict.confidence,
    reason: classifierVerdict.reason,
    missingCriteria: classifierVerdict.missing_criteria,
    suggestedRewrite: classifierVerdict.suggested_rewrite || null,
    cached: false,
  });

  await persist(supabase, userId, text, result);
  return result;
}
