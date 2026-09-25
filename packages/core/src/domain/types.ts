/**
 * Shared domain types. Kept dependency-free (no zod, no supabase) so this
 * file is safe to import from browser components, server actions, and the
 * worker alike. Runtime validation lives in `packages/core/src/schemas/`.
 */

export type RunStatus =
  | "draft"
  | "queued"
  | "running"
  | "awaiting_input"
  | "paused"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export type LeadQualificationStatus = "qualified" | "not_qualified" | "needs_review";

export type ToolCallStatus = "ok" | "error" | "denied" | "cache_hit" | "sent_back";

/**
 * SYSTEM-DESIGN-NEXTJS.md §7.2, plus "unavailable" from §13's failure
 * handling (the classifier is down; validation degrades permissive rather
 * than blocking).
 */
export type ValidationVerdict =
  | "valid"
  | "vague"
  | "incoherent"
  | "not_a_request"
  | "out_of_scope"
  | "out_of_scope_unsafe"
  | "unavailable";

export type Runner = "gemini" | "agent-sdk";
export type Scraper = "crawl4ai" | "firecrawl";

/** SYSTEM-DESIGN-NEXTJS.md §7's intake defaults table. */
export interface RunLimits {
  target_qualified: number;
  /** LinkedIn searches allowed this run (default 3). Raised by "Continue with more budget". Absent on runs created before it was per-run. */
  max_discover_attempts?: number;
  candidate_limit: number;
  scrape_limit: number;
  max_turns: number;
  max_tool_calls: number;
  max_spend_usd: number;
}

export interface RunCounters {
  candidates_seen?: number;
  /** How many discover_companies calls this run has made - gate()'s primary discovery cap now (max 3), separate from candidates_seen. */
  discover_calls_used?: number;
  scrapes_used?: number;
  tool_calls_used?: number;
  turns_used?: number;
  qualified_count: number;
  needs_review_count?: number;
}

/**
 * The subset of the `runs` row that `deriveRunActions` needs. Deliberately
 * narrow — this function must stay a pure, dependency-free UI/server-action
 * helper (SYSTEM-DESIGN-NEXTJS.md §17.5), not a full ORM row type.
 */
export interface Run {
  status: RunStatus;
  counters: RunCounters;
  /** Total leads saved so far, regardless of qualification status. */
  lead_count: number;
  /** A pause was requested while running; the worker hasn't reached a safe point yet. */
  pause_requested?: boolean;
  /** For a finished run: which budget stopped it, and how many more searches it can still be given. */
  limit_reached?: string | null;
  searches_left_to_add?: number;
}

/** SYSTEM-DESIGN-NEXTJS.md §17.5's action matrix. `resume` continues the same run (paused or failed); `rerun` ("Run again") starts a new run from a finished one's objective; `delete` removes the run and everything saved for it. */
export type RunAction =
  | "start"
  | "cancel"
  | "pause"
  | "resume"
  | "extend"
  | "rerun"
  | "editLimits"
  | "answerClarification"
  | "export"
  | "delete";

export type ActionState =
  | { kind: "enabled" }
  | { kind: "disabled"; reason: string }
  | { kind: "hidden" };
