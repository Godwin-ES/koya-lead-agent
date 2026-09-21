import type { ActionState, Run, RunAction } from "./types";

const ENABLED: ActionState = { kind: "enabled" };
const HIDDEN: ActionState = { kind: "hidden" };
const disabled = (reason: string): ActionState => ({ kind: "disabled", reason });

const NO_RESULTS_YET = disabled("No results yet");
const LOCKED_ONCE_QUEUED = disabled("Locked once queued");
const LOCKED_WHILE_RUNNING = disabled("Locked while the run is in progress");
const RUN_IN_PROGRESS = disabled("Run in progress");
const ALREADY_QUEUED = disabled("Already queued");
const WAITING_ON_ANSWER = disabled("Waiting on your answer");
const NO_LEADS_SAVED_YET = disabled("No leads have been saved yet");

/**
 * The exact table from SYSTEM-DESIGN-NEXTJS.md §17.5. Two cells ("running"
 * and "failed"/"cancelled" export) are conditional on whether any lead has
 * actually been saved yet, so they're computed below rather than being
 * static entries here.
 */
const STATIC_TABLE: Record<
  Exclude<Run["status"], "running" | "failed" | "cancelled">,
  Record<Exclude<RunAction, "export">, ActionState>
> & {
  running: Record<Exclude<RunAction, "export">, ActionState>;
  failed: Record<Exclude<RunAction, "export">, ActionState>;
  cancelled: Record<Exclude<RunAction, "export">, ActionState>;
} = {
  draft: {
    start: ENABLED,
    cancel: HIDDEN,
    retry: HIDDEN,
    rerun: HIDDEN,
    editLimits: ENABLED,
    answerClarification: HIDDEN,
  },
  queued: {
    start: ALREADY_QUEUED,
    cancel: ENABLED,
    retry: HIDDEN,
    rerun: HIDDEN,
    editLimits: LOCKED_ONCE_QUEUED,
    answerClarification: HIDDEN,
  },
  running: {
    start: RUN_IN_PROGRESS,
    cancel: ENABLED,
    retry: RUN_IN_PROGRESS,
    rerun: HIDDEN,
    editLimits: LOCKED_WHILE_RUNNING,
    answerClarification: HIDDEN,
  },
  awaiting_input: {
    start: WAITING_ON_ANSWER,
    cancel: ENABLED,
    retry: HIDDEN,
    rerun: HIDDEN,
    editLimits: disabled("Locked while a clarification is pending"),
    answerClarification: ENABLED,
  },
  completed: {
    start: HIDDEN,
    cancel: HIDDEN,
    retry: HIDDEN,
    rerun: ENABLED,
    editLimits: HIDDEN,
    answerClarification: HIDDEN,
  },
  partial: {
    start: HIDDEN,
    cancel: HIDDEN,
    retry: HIDDEN,
    rerun: ENABLED,
    editLimits: HIDDEN,
    answerClarification: HIDDEN,
  },
  failed: {
    start: HIDDEN,
    cancel: HIDDEN,
    retry: ENABLED,
    rerun: ENABLED,
    editLimits: HIDDEN,
    answerClarification: HIDDEN,
  },
  cancelled: {
    start: HIDDEN,
    cancel: HIDDEN,
    retry: HIDDEN,
    rerun: ENABLED,
    editLimits: HIDDEN,
    answerClarification: HIDDEN,
  },
};

/** Terminal statuses never get a fresh `start` or `retry` - only `rerun`. */
const TERMINAL_STATUSES: ReadonlySet<Run["status"]> = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

/**
 * Computes which of the seven run actions are enabled, disabled (with a
 * reason), or hidden for a given run. This is the single source of truth
 * both the UI and the server-action guard call (SYSTEM-DESIGN-NEXTJS.md
 * §17.5) - neither may offer or accept an action the other disagrees with.
 *
 * Kept a pure function with no imports beyond types so it stays safe to
 * call from browser components, server actions, and the worker alike.
 */
export function deriveRunActions(run: Run): Record<RunAction, ActionState> {
  const table = STATIC_TABLE[run.status];
  const hasLeads = (run.lead_count ?? 0) > 0;

  let exportState: ActionState;
  if (run.status === "draft" || run.status === "queued" || run.status === "awaiting_input") {
    exportState = NO_RESULTS_YET;
  } else if (run.status === "running") {
    exportState = hasLeads ? ENABLED : NO_RESULTS_YET;
  } else if (run.status === "completed" || run.status === "partial") {
    exportState = ENABLED;
  } else {
    // failed | cancelled
    exportState = hasLeads ? ENABLED : NO_LEADS_SAVED_YET;
  }

  return {
    ...table,
    export: exportState,
  };
}

export { TERMINAL_STATUSES };
