import type { RunStatus } from "./types";
import { TERMINAL_STATUSES } from "./run-actions";

/**
 * The seven phases of SYSTEM-DESIGN-NEXTJS.md §17.7's phase tracker:
 * "Validate → ICP → Discover → Scrape → Qualify → Draft → Finalize,
 * each with its own state. Phases reflect real recorded state; there is
 * never a progress indicator that moves on a timer rather than on
 * evidence." Each phase's "done" state is derived from data that
 * already exists on the run/leads/drafts, not from a separate phase
 * event stream neither runner currently emits.
 */
export const PHASE_IDS = ["validate", "icp", "discover", "scrape", "qualify", "draft", "finalize"] as const;
export type PhaseId = (typeof PHASE_IDS)[number];

export type PhaseState = "done" | "current" | "pending";

export interface PhaseInput {
  status: RunStatus;
  hasIcp: boolean;
  candidatesSeen: number;
  scrapesUsed: number;
  hasLeads: boolean;
  hasDrafts: boolean;
}

const PHASE_LABELS: Record<PhaseId, string> = {
  validate: "Validate",
  icp: "ICP",
  discover: "Discover",
  scrape: "Scrape",
  qualify: "Qualify",
  draft: "Draft",
  finalize: "Finalize",
};

export function phaseLabel(id: PhaseId): string {
  return PHASE_LABELS[id];
}

export function derivePhases(input: PhaseInput): Record<PhaseId, PhaseState> {
  // objective_validations already happened before this run row could
  // even exist (§7.1) - "validate" is always done for any real run.
  const isTerminal = TERMINAL_STATUSES.has(input.status);

  const done: Record<PhaseId, boolean> = {
    validate: true,
    icp: input.hasIcp,
    discover: input.candidatesSeen > 0,
    scrape: input.scrapesUsed > 0,
    qualify: input.hasLeads,
    draft: input.hasDrafts,
    finalize: isTerminal,
  };

  const result = {} as Record<PhaseId, PhaseState>;
  let currentAssigned = false;

  for (const id of PHASE_IDS) {
    if (done[id]) {
      result[id] = "done";
      continue;
    }
    // Only a genuinely in-progress run gets a "current" marker - a
    // queued or awaiting_input run has no phase actively advancing.
    if (!currentAssigned && input.status === "running") {
      result[id] = "current";
      currentAssigned = true;
    } else {
      result[id] = "pending";
    }
  }

  return result;
}
