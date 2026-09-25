import { describe, expect, it } from "vitest";
import { computeStopDetails, unfinishedWork, type FinishCheckInput, searchNotNeeded } from "@core/tools/finish-check";

const base: FinishCheckInput = {
  targetQualified: 10,
  qualified: [{ companyName: "Acme", draftParts: ["email 1", "email 2", "email 3", "LinkedIn"] }],
  undecidedDomains: [],
  attemptsUsed: 3,
  maxAttempts: 3,
  scrapesUsed: 10,
  scrapeLimit: 120,
  candidatesSeen: 40,
  candidateLimit: 60,
  toolCallsUsed: 50,
  maxToolCalls: 400,
};

describe("unfinishedWork", () => {
  it("allows finalizing once searches are used up and every kept candidate is evaluated", () => {
    expect(unfinishedWork(base)).toBeNull();
  });

  it("uses the run's own search limit - a run given more searches must use them", () => {
    expect(unfinishedWork({ ...base, maxAttempts: 5 })).toMatch(/2 discovery attempts remain/);
  });

  // Real gap: with the tool-call budget gone, save_outreach is denied too, so
  // demanding the missing drafts left the agent refused on both sides until the turn limit.
  it("never demands work the tool-call budget can no longer pay for", () => {
    const incomplete = { ...base, qualified: [{ companyName: "Acme", draftParts: ["email 1"] }] };
    expect(unfinishedWork(incomplete)).toMatch(/outreach is incomplete for Acme/);
    expect(unfinishedWork({ ...incomplete, toolCallsUsed: 399 })).toBeNull();
  });
});

describe("computeStopDetails", () => {
  const counts = {
    qualified: 6,
    target: 10,
    searches_used: 3,
    searches_limit: 3,
    kept: 38,
    undecided: 0,
    scrapes_used: 40,
    scrape_limit: 120,
    candidates_seen: 40,
    candidate_limit: 60,
    turns_used: 60,
    max_turns: 150,
    tool_calls_used: 120,
    max_tool_calls: 400,
  };

  it("names the budget that stopped a run short of its target, from its records", () => {
    expect(computeStopDetails(counts, false).limit_reached).toBe("searches");
    expect(computeStopDetails({ ...counts, undecided: 5, scrapes_used: 120 }, false).limit_reached).toBe("scrapes");
    expect(computeStopDetails({ ...counts, searches_used: 1, candidates_seen: 60 }, false).limit_reached).toBe("candidates");
    expect(computeStopDetails({ ...counts, tool_calls_used: 400 }, false).limit_reached).toBe("tool_calls");
    expect(computeStopDetails(counts, true).limit_reached).toBe("turns");
  });

  it("names no limit when the target was met", () => {
    expect(computeStopDetails({ ...counts, qualified: 10 }, true).limit_reached).toBeNull();
  });
});

describe("searchNotNeeded", () => {
  const base = { targetQualified: 5, qualifiedCount: 0, undecidedDomains: [] as string[], scrapesUsed: 9, scrapeLimit: 60 };
  const domains = (n: number) => Array.from({ length: n }, (_, i) => `c${i}.com`);

  it("sends a search back while the unevaluated candidates could still reach the target (the live Sonnet 5 case)", () => {
    const message = searchNotNeeded({ ...base, undecidedDomains: domains(13) });
    expect(message).toContain("13 kept candidates haven't been evaluated");
    expect(message).toContain("didn't use a search");
  });

  it("counts only what's still needed", () => {
    expect(searchNotNeeded({ ...base, qualifiedCount: 3, undecidedDomains: domains(2) })).not.toBeNull();
    expect(searchNotNeeded({ ...base, qualifiedCount: 3, undecidedDomains: domains(1) })).toBeNull();
  });

  it("allows a search when too few candidates are left to reach the target", () => {
    expect(searchNotNeeded({ ...base, undecidedDomains: domains(4) })).toBeNull();
    expect(searchNotNeeded(base)).toBeNull();
  });

  it("allows a search once the scrape budget can't evaluate the candidates anyway", () => {
    expect(searchNotNeeded({ ...base, undecidedDomains: domains(13), scrapesUsed: 60 })).toBeNull();
  });

  it("sends a search back once the target is already met", () => {
    expect(searchNotNeeded({ ...base, qualifiedCount: 5 })).toContain("move on to outreach");
  });
});
