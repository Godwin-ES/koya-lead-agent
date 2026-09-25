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
const PAUSING = disabled("Pausing - finishing the current step");
const STOP_BEFORE_DELETING = disabled("Pause or cancel the run first - it can be deleted once it has stopped");

type ActionRow = Record<Exclude<RunAction, "export" | "delete">, ActionState>;

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.5, revised so each state offers one way
 * forward instead of two look-alike buttons: Pause/Resume for a run that
 * isn't finished, "Continue with more budget" (`extend`) for one that
 * finished short of its target, "Run again" (`rerun`) for one that
 * finished or was cancelled. A failed run is
 * resumed, not re-run: every failure cause seen so far (rate limit, bad
 * key, sidecar down, daily quota) is fixed outside the run, after which
 * continuing is right and re-running would repeat paid work.
 */
const TABLE: Record<Run["status"], ActionRow> = {
  draft: { start: ENABLED, cancel: HIDDEN, pause: HIDDEN, resume: HIDDEN, extend: HIDDEN, rerun: HIDDEN, editLimits: ENABLED, answerClarification: HIDDEN },
  queued: { start: ALREADY_QUEUED, cancel: ENABLED, pause: ENABLED, resume: HIDDEN, extend: HIDDEN, rerun: HIDDEN, editLimits: LOCKED_ONCE_QUEUED, answerClarification: HIDDEN },
  running: { start: RUN_IN_PROGRESS, cancel: ENABLED, pause: ENABLED, resume: HIDDEN, extend: HIDDEN, rerun: HIDDEN, editLimits: LOCKED_WHILE_RUNNING, answerClarification: HIDDEN },
  awaiting_input: {
    start: WAITING_ON_ANSWER,
    cancel: ENABLED,
    pause: HIDDEN,
    resume: HIDDEN,
    extend: HIDDEN,
    rerun: HIDDEN,
    editLimits: disabled("Locked while a clarification is pending"),
    answerClarification: ENABLED,
  },
  paused: { start: HIDDEN, cancel: ENABLED, pause: HIDDEN, resume: ENABLED, extend: HIDDEN, rerun: HIDDEN, editLimits: HIDDEN, answerClarification: HIDDEN },
  completed: { start: HIDDEN, cancel: HIDDEN, pause: HIDDEN, resume: HIDDEN, extend: HIDDEN, rerun: ENABLED, editLimits: HIDDEN, answerClarification: HIDDEN },
  partial: { start: HIDDEN, cancel: HIDDEN, pause: HIDDEN, resume: HIDDEN, extend: ENABLED, rerun: HIDDEN, editLimits: HIDDEN, answerClarification: HIDDEN },
  failed: { start: HIDDEN, cancel: HIDDEN, pause: HIDDEN, resume: ENABLED, extend: HIDDEN, rerun: HIDDEN, editLimits: HIDDEN, answerClarification: HIDDEN },
  cancelled: { start: HIDDEN, cancel: HIDDEN, pause: HIDDEN, resume: HIDDEN, extend: HIDDEN, rerun: ENABLED, editLimits: HIDDEN, answerClarification: HIDDEN },
};

/** Statuses a run ends in. Only a partial one can be continued (`extend`); the rest are only ever run again. */
const TERMINAL_STATUSES: ReadonlySet<Run["status"]> = new Set(["completed", "partial", "failed", "cancelled"]);

/**
 * Which run actions are enabled, disabled (with a reason), or hidden. The
 * single source of truth both the UI and the server-action guard call
 * (SYSTEM-DESIGN-NEXTJS.md §17.5). Pure, type-only imports, so it's safe
 * from browser components, server actions and the worker alike.
 */
export function deriveRunActions(run: Run): Record<RunAction, ActionState> {
  const row = { ...TABLE[run.status] };
  if (run.status === "running" && run.pause_requested) row.pause = PAUSING;
  if (run.status === "partial" && run.limit_reached === "searches" && run.searches_left_to_add === 0) {
    row.extend = disabled("This run already has the most searches allowed");
  }

  const hasLeads = (run.lead_count ?? 0) > 0;
  let exportState: ActionState;
  if (run.status === "draft" || run.status === "queued" || run.status === "awaiting_input") {
    exportState = NO_RESULTS_YET;
  } else if (run.status === "running" || run.status === "paused") {
    exportState = hasLeads ? ENABLED : NO_RESULTS_YET;
  } else if (run.status === "completed" || run.status === "partial") {
    exportState = ENABLED;
  } else {
    // failed | cancelled
    exportState = hasLeads ? ENABLED : NO_LEADS_SAVED_YET;
  }

  // Anything but a run a worker is executing right now; delete_run re-checks under a row lock.
  const deleteState = run.status === "running" ? STOP_BEFORE_DELETING : ENABLED;

  return { ...row, export: exportState, delete: deleteState };
}

export { TERMINAL_STATUSES };
