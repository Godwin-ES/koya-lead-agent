import type { RunLimits } from "@core/domain/types";
import { MAX_DISCOVER_ATTEMPTS } from "@core/tools/gate";

/**
 * Shared between both runners (Task 14 Gemini, Task 15 Agent SDK) so the
 * two differ only in mechanism, not in what the agent is actually told
 * to do (SYSTEM-DESIGN-NEXTJS.md §12: "Phase prompts live in
 * orchestrator.ts and are shared with the Agent SDK runner").
 */
export interface OrchestratorRun {
  objectiveRaw: string;
  clarificationAnswer?: string | null;
  limits: RunLimits;
}

export function buildPhasePrompt(run: OrchestratorRun): string {
  const lines = [`Qualification objective: ${run.objectiveRaw}`];

  if (run.clarificationAnswer) {
    lines.push(`The user's answer to your clarifying question: ${run.clarificationAnswer}`);
  }

  lines.push(
    [
      `Target qualified leads: ${run.limits.target_qualified}.`,
      `You have at most ${MAX_DISCOVER_ATTEMPTS} discover_companies calls this run - use them deliberately.`,
      "If your first search doesn't turn up enough qualified leads, don't repeat the same query: change the angle (different phrasing, a different signal like a job board or funding announcement site, a different geography or industry term) before your next attempt, informed by what you saw disqualify candidates so far.",
      `Scrape budget: ${run.limits.scrape_limit}.`,
      "Work within these limits. Call finalize_run once you have enough qualified leads, or once you've used your discovery attempts and want to report what you found.",
    ].join(" "),
  );

  return lines.join("\n\n");
}
