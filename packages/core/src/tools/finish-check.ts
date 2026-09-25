/**
 * Whether the run still has work it can usefully do before finalizing,
 * and if so, what. Live, a resumed run drafted outreach for its 5 leads,
 * then finalized at 5 of 10 "within budget" with 32 kept candidates never
 * scraped, 114 scrape pages and 1 search left - nothing stopped it.
 *
 * Order matters: finish what's started (outreach for qualified leads),
 * then use the candidates already found, and only then search again.
 * Work the remaining budget can't pay for is never demanded - once the
 * tool-call budget is gone, save_outreach is denied too, and requiring it
 * here would leave the agent refused on both sides until the turn limit.
 */
export interface FinishCheckInput {
  targetQualified: number;
  qualified: Array<{ companyName: string; draftParts: string[] }>;
  /** Kept candidates with no saved lead yet, in discovery order. */
  undecidedDomains: string[];
  attemptsUsed: number;
  maxAttempts: number;
  scrapesUsed: number;
  scrapeLimit: number;
  candidatesSeen: number;
  candidateLimit: number;
  toolCallsUsed: number;
  maxToolCalls: number;
}

const OUTREACH_PARTS = ["email 1", "email 2", "email 3", "LinkedIn"];

/** A few calls held back so the agent can still save a draft or finalize once the budget is nearly spent. */
const TOOL_CALL_HEADROOM = 1;

export function unfinishedWork(input: FinishCheckInput): string | null {
  if (input.toolCallsUsed + TOOL_CALL_HEADROOM >= input.maxToolCalls) return null;

  const missingOutreach = input.qualified
    .map((l) => ({ name: l.companyName, missing: OUTREACH_PARTS.filter((p) => !l.draftParts.includes(p)) }))
    .filter((l) => l.missing.length);
  if (missingOutreach.length) {
    return `Not finalized: outreach is incomplete for ${missingOutreach.map((l) => `${l.name} (missing ${l.missing.join(", ")})`).join("; ")}. Save the missing drafts first - a draft sent back earlier can be fixed and saved again.`;
  }

  const qualifiedCount = input.qualified.length;
  if (qualifiedCount >= input.targetQualified) return null;

  const short = `${qualifiedCount} of ${input.targetQualified} qualified`;
  if (input.undecidedDomains.length && input.scrapesUsed < input.scrapeLimit) {
    const shown = input.undecidedDomains.slice(0, 12);
    return `Not finalized: ${short}, and ${input.undecidedDomains.length} kept candidates haven't been evaluated yet: ${shown.join(", ")}${input.undecidedDomains.length > shown.length ? ", ..." : ""}. Scrape and qualify them before searching again or finalizing.`;
  }

  if (input.attemptsUsed < input.maxAttempts && input.candidatesSeen < input.candidateLimit) {
    const left = input.maxAttempts - input.attemptsUsed;
    return `Not finalized: ${short}, every kept candidate has been evaluated, and ${left} discovery attempt${left === 1 ? "" : "s"} remain. Search again: the next page of a search that found good companies, or a different keyword or industry if they were the wrong kind.`;
  }

  return null;
}

export interface SearchCheckInput {
  targetQualified: number;
  qualifiedCount: number;
  /** Kept candidates with no saved lead yet, in discovery order. */
  undecidedDomains: string[];
  scrapesUsed: number;
  scrapeLimit: number;
}

/**
 * Whether a new search would be premature. Live (Sonnet 5, target 5), the
 * agent had 13 kept candidates and no decisions yet, and still asked for
 * page 2 - which it never needed: 5 qualified came from the first 9. While
 * the unevaluated candidates could still cover what's left of the target,
 * they come first. Fewer than that, and more candidates are needed anyway.
 */
export function searchNotNeeded(input: SearchCheckInput): string | null {
  const needed = input.targetQualified - input.qualifiedCount;
  if (needed <= 0) return `Search not needed: ${input.qualifiedCount} of ${input.targetQualified} qualified already - move on to outreach.`;
  if (input.scrapesUsed >= input.scrapeLimit) return null;
  const undecided = input.undecidedDomains.length;
  if (undecided < needed) return null;
  const shown = input.undecidedDomains.slice(0, 12);
  return `Search not needed yet: ${input.qualifiedCount} of ${input.targetQualified} qualified, and ${undecided} kept candidate${undecided === 1 ? "" : "s"} haven't been evaluated: ${shown.join(", ")}${undecided > shown.length ? ", ..." : ""}. Scrape and save_lead them first; search again only if they don't reach the target. This didn't use a search.`;
}

/** Which budget ended the run short of its target - null when the target was met. */
export type LimitReached = "searches" | "candidates" | "scrapes" | "turns" | "tool_calls" | null;

/**
 * What stopped the run, worked out from its records at finalize - never
 * from the model's own summary, which live claimed "full 3-step sequences"
 * that didn't exist. Stored on the run and shown to the user as the reason,
 * with the matching way to continue.
 */
export interface StopDetails {
  limit_reached: LimitReached;
  qualified: number;
  target: number;
  searches_used: number;
  searches_limit: number;
  kept: number;
  undecided: number;
  scrapes_used: number;
  scrape_limit: number;
  candidates_seen: number;
  candidate_limit: number;
  turns_used: number;
  max_turns: number;
  tool_calls_used: number;
  max_tool_calls: number;
}

export function computeStopDetails(input: Omit<StopDetails, "limit_reached">, forcedByTurnLimit: boolean): StopDetails {
  let limit: LimitReached = null;
  if (input.qualified < input.target) {
    if (forcedByTurnLimit || input.turns_used >= input.max_turns) limit = "turns";
    else if (input.tool_calls_used + TOOL_CALL_HEADROOM >= input.max_tool_calls) limit = "tool_calls";
    else if (input.undecided > 0 && input.scrapes_used >= input.scrape_limit) limit = "scrapes";
    else if (input.searches_used >= input.searches_limit) limit = "searches";
    else if (input.candidates_seen >= input.candidate_limit) limit = "candidates";
  }
  return { ...input, limit_reached: limit };
}

/** Why a run stopped short, as a sentence ending - shared by the run page's banner and the Discord message. */
export function stopReasonText(d: StopDetails): string {
  switch (d.limit_reached) {
    case "searches":
      return `all ${d.searches_used} of ${d.searches_limit} searches were used${d.undecided === 0 ? `, and every one of the ${d.kept} companies they kept was evaluated` : ""}.`;
    case "scrapes":
      return `the scrape budget ran out (${d.scrapes_used} of ${d.scrape_limit} pages) with ${d.undecided} kept compan${d.undecided === 1 ? "y" : "ies"} still to evaluate.`;
    case "candidates":
      return `the candidate budget ran out (${d.candidates_seen} of ${d.candidate_limit} companies).`;
    case "turns":
      return `it reached its limit of ${d.max_turns} model turns.`;
    case "tool_calls":
      return `it used its ${d.max_tool_calls} tool calls.`;
    default:
      return "the agent found no more companies that fit.";
  }
}
