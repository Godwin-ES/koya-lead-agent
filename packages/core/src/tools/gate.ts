import type { RunLimits, RunCounters } from "../domain/types";

/**
 * The eight tools the agent may ever call (SYSTEM-DESIGN-NEXTJS.md §8,
 * Task 12). Anything not in this list - Bash, WebFetch, Read, Write,
 * Edit, Glob, Grep, Task, WebSearch, or any name a model hallucinates -
 * is denied outright, regardless of runner. This is what makes "the
 * agent cannot touch the filesystem or the open web" true at the
 * enforcement layer, not just by convention in a system prompt.
 */
export const TOOL_NAMES = [
  "save_icp",
  "request_clarification",
  "discover_companies",
  "scrape_site",
  "save_lead",
  "save_outreach",
  "list_run_state",
  "finalize_run",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

/** list_run_state is read-only and free - the agent can check its own progress without spending budget (§12). */
const UNCOUNTED_TOOLS: ReadonlySet<ToolName> = new Set(["list_run_state"]);

/** Tools usable before the ICP has been saved - everything else needs ICP criteria to act on. */
const ICP_EXEMPT_TOOLS: ReadonlySet<ToolName> = new Set(["save_icp", "request_clarification", "list_run_state"]);

/**
 * Everything `gate()` needs to decide, already resolved by the caller.
 * Deliberately not a database row type: `gate()` is a pure, synchronous
 * function (matching `deriveRunActions`'s own precedent) so it stays
 * trivially unit-testable and so its three call sites (a PreToolUse
 * hook, the tool handler, and `canUseTool` for `request_clarification` -
 * see docs/provider-findings.md's "MAJOR CORRECTION") all evaluate the
 * exact same logic against a snapshot they already hold, with no risk of
 * one call site's database round trip disagreeing with another's.
 */
export interface GateRunState {
  icp: unknown;
  limits: RunLimits;
  counters: RunCounters;
  clarificationCount: number;
  /** Current run spend, summed from cost_ledger by the caller before invoking gate(). */
  spentUsd: number;
}

export type GateDecision =
  | { kind: "allow"; input: Record<string, unknown> }
  | { kind: "deny"; reason: string; agentMessage: string };

function deny(reason: string, agentMessage: string): GateDecision {
  return { kind: "deny", reason, agentMessage };
}

export function gate(run: GateRunState, toolName: string, input: Record<string, unknown>): GateDecision {
  if (!isToolName(toolName)) {
    return deny(`"${toolName}" is not an allowed tool`, "That action is not available to you. Continue using only save_icp, request_clarification, discover_companies, scrape_site, save_lead, save_outreach, list_run_state, and finalize_run.");
  }

  if (!ICP_EXEMPT_TOOLS.has(toolName) && !run.icp) {
    return deny("icp not saved yet", "Save the ICP with save_icp before using this tool.");
  }

  if (toolName === "request_clarification" && run.clarificationCount >= 1) {
    return deny(
      "clarification already requested once this run",
      "You already asked one clarifying question this run. Proceed with your best interpretation of the objective rather than asking again.",
    );
  }

  if (toolName === "discover_companies") {
    const seen = run.counters.candidates_seen ?? 0;
    if (seen >= run.limits.candidate_limit) {
      return deny(
        "candidate limit reached",
        "You have reached the candidate discovery limit for this run. Qualify from the candidates you already have.",
      );
    }
  }

  if (toolName === "scrape_site") {
    const used = run.counters.scrapes_used ?? 0;
    if (used >= run.limits.scrape_limit) {
      return deny(
        "scrape budget exhausted",
        "You have used your scrape budget for this run. Qualify from the evidence you already have rather than scraping further.",
      );
    }
  }

  if (!UNCOUNTED_TOOLS.has(toolName)) {
    const toolCallsUsed = run.counters.tool_calls_used ?? 0;
    if (toolCallsUsed >= run.limits.max_tool_calls) {
      return deny("tool call limit reached", "You have used your tool call budget for this run. Finalize with what you have.");
    }

    if (run.spentUsd >= run.limits.max_spend_usd) {
      return deny("spend ceiling reached", "You have reached the spend ceiling for this run. Finalize with what you have.");
    }
  }

  return { kind: "allow", input };
}
