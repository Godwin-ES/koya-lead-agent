/**
 * The single source of truth for every status label, icon, and tone in the
 * app (SYSTEM-DESIGN-NEXTJS.md §17.2: "Status rendering has a single source
 * of truth... A status can therefore never render as a green 'Completed'
 * on one page and an amber 'Done' on another."). No component may
 * hardcode a status label or colour - it looks these up here.
 *
 * `icon` names are lucide-react component names, kept as strings so this
 * module stays free of a React dependency and importable from the worker.
 * `tone` maps to the design system's semantic colour tokens
 * (SYSTEM-DESIGN-NEXTJS.md §17.2).
 */

export const APP_NAME = "Koya Lead Agent";

export type StatusTone = "neutral" | "info" | "warning" | "success" | "danger";

export interface StatusEntry {
  label: string;
  icon: string;
  tone: StatusTone;
}

/** SYSTEM-DESIGN-NEXTJS.md §6, the run lifecycle state machine. */
export const RUN_STATUS = {
  draft: { label: "Draft", icon: "FileEdit", tone: "neutral" },
  queued: { label: "Queued", icon: "Clock", tone: "info" },
  running: { label: "Running", icon: "Loader2", tone: "info" },
  awaiting_input: { label: "Needs answer", icon: "HelpCircle", tone: "warning" },
  paused: { label: "Paused", icon: "PauseCircle", tone: "neutral" },
  completed: { label: "Completed", icon: "CheckCircle2", tone: "success" },
  partial: { label: "Partial", icon: "AlertTriangle", tone: "warning" },
  failed: { label: "Failed", icon: "XCircle", tone: "danger" },
  cancelled: { label: "Cancelled", icon: "Ban", tone: "neutral" },
} as const satisfies Record<string, StatusEntry>;

/** assets/lead-qualification-guide.md's three qualification statuses. */
export const LEAD_STATUS = {
  qualified: { label: "Qualified", icon: "CheckCircle2", tone: "success" },
  not_qualified: { label: "Not qualified", icon: "XCircle", tone: "neutral" },
  needs_review: { label: "Needs review", icon: "AlertTriangle", tone: "warning" },
} as const satisfies Record<string, StatusEntry>;

/** SYSTEM-DESIGN-NEXTJS.md §16's `tool_calls.status` values. */
export const TOOL_CALL_STATUS = {
  ok: { label: "OK", icon: "CheckCircle2", tone: "success" },
  error: { label: "Error", icon: "XCircle", tone: "danger" },
  denied: { label: "Denied", icon: "ShieldOff", tone: "warning" },
  cache_hit: { label: "Cache hit", icon: "Database", tone: "info" },
  sent_back: { label: "Sent back to fix", icon: "RotateCcw", tone: "info" },
} as const satisfies Record<string, StatusEntry>;

/**
 * SYSTEM-DESIGN-NEXTJS.md §7.2's six verdicts, plus "unavailable" from
 * §13's failure handling (classifier outage degrades permissive rather
 * than blocking a run).
 */
export const VALIDATION_VERDICT = {
  valid: { label: "Valid", icon: "CheckCircle2", tone: "success" },
  vague: { label: "Vague", icon: "AlertTriangle", tone: "warning" },
  incoherent: { label: "Incoherent", icon: "AlertTriangle", tone: "warning" },
  not_a_request: { label: "Not a request", icon: "HelpCircle", tone: "warning" },
  out_of_scope: { label: "Out of scope", icon: "AlertTriangle", tone: "danger" },
  out_of_scope_unsafe: { label: "Not allowed", icon: "ShieldAlert", tone: "danger" },
  unavailable: { label: "Not checked", icon: "HelpCircle", tone: "neutral" },
} as const satisfies Record<string, StatusEntry>;
