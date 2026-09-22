import type { RunLimits } from "@core/domain/types";

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
      `Candidate discovery budget: ${run.limits.candidate_limit}.`,
      `Scrape budget: ${run.limits.scrape_limit}.`,
      "Work within these limits. Call finalize_run once you have enough qualified leads, or once you've made a reasonable, budget-respecting effort and want to report what you found.",
    ].join(" "),
  );

  return lines.join("\n\n");
}
