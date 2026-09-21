import { callCheapModel } from "../providers/model/cheap-model";
import { withRecording } from "../providers/replay/recorder";
import { hashObjective } from "../domain/normalize";
import { ValidationVerdictSchema, MISSING_CRITERIA_KEYS, type ClassifierVerdict } from "../schemas/validation";

/**
 * SYSTEM-DESIGN-NEXTJS.md §7.1's Stage 2: one structured-output call on
 * the cheap model (never the agent's own model - §12), only reached for
 * objectives that already passed Stage 1. `missing_criteria` is
 * constrained to the eight items in the ICP guide's "Minimum Criteria To
 * Clarify" list so its output is directly reusable by the agent's own
 * ICP-refinement step, not free text needing its own parsing.
 */
const SYSTEM_PROMPT = `You classify whether a lead-qualification objective, written by a business user, is specific enough for an AI agent to research and qualify companies against.

Classify the objective into exactly one verdict:
- "valid": specific enough to search on - has a target company type or industry, and at least some sense of geography, size, or persona.
- "vague": on-topic but missing real detail (e.g. "find some tech companies"). List which of the eight ICP criteria are missing.
- "incoherent": not coherent English, or too garbled to interpret.
- "not_a_request": coherent text, but not actually an instruction to find or qualify companies (e.g. a statement, a question about something else).
- "out_of_scope": a real request, but for something this system does not do (e.g. writing content, unrelated research).
- "out_of_scope_unsafe": asks the system to find personal email addresses, verify email deliverability, or send outreach to anyone - capabilities this system deliberately does not have.

The eight ICP criteria (use these exact keys in missing_criteria): ${MISSING_CRITERIA_KEYS.join(", ")}.

Be conservative: prefer "valid" over "vague" when an objective is short but genuinely specific (e.g. names an industry and a headcount range). Only use "out_of_scope_unsafe" when the objective explicitly asks for personal contact discovery, deliverability checks, or sending - never for an objective that is merely vague about outreach.

If the objective gives a rewrite-worthy vague request, suggest a concrete, narrower rewrite in suggested_rewrite; otherwise leave it empty.`;

export async function classifyObjective(objective: string): Promise<ClassifierVerdict> {
  const key = `classifier:objective:${hashObjective(objective)}`;

  const raw = await withRecording(key, async () => {
    const result = await callCheapModel(objective, ValidationVerdictSchema, {
      schemaName: "objective_verdict",
      system: SYSTEM_PROMPT,
    });
    return result.data;
  });

  // Validated on both paths, not just the fresh-call one: a replayed
  // fixture is just a JSON file on disk by the time it reaches here -
  // withRecording has no schema awareness, so a corrupted or hand-edited
  // fixture would otherwise flow straight into the gate's logic
  // unchecked. Caught by classifier.test.ts's corrupted-fixture case.
  return ValidationVerdictSchema.parse(raw);
}
