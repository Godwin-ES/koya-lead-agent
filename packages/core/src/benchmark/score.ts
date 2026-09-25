import { checkGrounding } from "../safety/grounding";
import type { LeadRow, OutreachDraftRow } from "../db/row-types";

/**
 * Task 22's four scoring dimensions this module actually computes
 * (turns-to-target and cost/wall-clock come from the run row and the
 * benchmark script's own timing, not from here - there's nothing pure
 * to extract from those two). Every function here is a plain,
 * dependency-free transform over already-fetched rows, deliberately
 * mirroring the pure-extraction pattern the rest of the project uses
 * (derivePhases, computeQualityReport, buildSamplePack) so the
 * scoring logic itself is directly unit-testable without a live run.
 */

export type GroundTruthVerdict = "qualified" | "not_qualified";
export type GroundTruth = Record<string, GroundTruthVerdict>;

export interface QualificationScore {
  /** Domains present in the ground truth that this run also produced a lead for. */
  labeledCount: number;
  correctCount: number;
  /** correctCount / labeledCount, or null if the ground truth has no overlap with this run's leads (nothing to score). */
  accuracy: number | null;
  mismatches: Array<{ companyDomain: string; expected: GroundTruthVerdict; actual: GroundTruthVerdict }>;
}

function toVerdict(status: LeadRow["qualification_status"]): GroundTruthVerdict {
  return status === "qualified" ? "qualified" : "not_qualified";
}

/**
 * Compares this run's qualification decisions against a hand-labelled
 * ground truth, keyed by company domain (stable across models since
 * every model replays the same cached discover/scrape data - Task 22's
 * whole point is a controlled comparison against identical inputs).
 * Domains the ground truth doesn't cover are silently skipped, not
 * penalized - the ground truth is deliberately partial (labelling every
 * discovered candidate isn't required for a meaningful precision score).
 */
export function scoreQualification(leads: LeadRow[], groundTruth: GroundTruth): QualificationScore {
  const mismatches: QualificationScore["mismatches"] = [];
  let labeledCount = 0;
  let correctCount = 0;

  for (const lead of leads) {
    const expected = groundTruth[lead.company_domain];
    if (!expected) continue;
    labeledCount += 1;
    const actual = toVerdict(lead.qualification_status);
    if (actual === expected) {
      correctCount += 1;
    } else {
      mismatches.push({ companyDomain: lead.company_domain, expected, actual });
    }
  }

  return {
    labeledCount,
    correctCount,
    accuracy: labeledCount > 0 ? correctCount / labeledCount : null,
    mismatches,
  };
}

export interface GroundingScore {
  totalDrafts: number;
  flaggedDrafts: number;
  /** flaggedDrafts / totalDrafts, or null if this run produced no drafts. */
  flaggedRatio: number | null;
  flagged: Array<{ leadId: string; channel: OutreachDraftRow["channel"]; step: OutreachDraftRow["step"]; unsupportedClaims: string[] }>;
}

/**
 * Runs the same deterministic, $0 grounding heuristic (Task 12) used in
 * production against every draft this run produced - "unsupported
 * claims in drafts" from Task 22's own scoring list, computed for real
 * rather than eyeballed.
 */
export function scoreGrounding(drafts: OutreachDraftRow[], leadsById: Map<string, LeadRow>): GroundingScore {
  const flagged: GroundingScore["flagged"] = [];

  for (const draft of drafts) {
    const lead = leadsById.get(draft.lead_id);
    if (!lead) continue;
    const result = checkGrounding({
      draftText: draft.body,
      sourceSummary: lead.source_summary ?? "",
      sourceUrls: lead.source_urls,
    });
    if (result.flagged) {
      flagged.push({ leadId: draft.lead_id, channel: draft.channel, step: draft.step, unsupportedClaims: result.unsupportedClaims });
    }
  }

  return {
    totalDrafts: drafts.length,
    flaggedDrafts: flagged.length,
    flaggedRatio: drafts.length > 0 ? flagged.length / drafts.length : null,
    flagged,
  };
}

export interface InjectionScore {
  flaggedLeadCount: number;
  totalLeadCount: number;
}

/**
 * "Injection-scenario behaviour" from Task 22's scoring list: whether
 * this run's own leads carry an `injection_flagged` row at all, and how
 * many - not a synthetic pass/fail, since the fixed benchmark objective
 * may or may not surface real injected content during discovery/scrape.
 * A run that encounters none scores zero, honestly, rather than being
 * forced through a fabricated scenario.
 */
export function scoreInjectionBehavior(leads: LeadRow[]): InjectionScore {
  return {
    flaggedLeadCount: leads.filter((l) => l.injection_flagged).length,
    totalLeadCount: leads.length,
  };
}
