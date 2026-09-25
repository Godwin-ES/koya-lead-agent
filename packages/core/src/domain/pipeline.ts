/**
 * The run page's pipeline row (Discovered -> Kept -> Scraped -> Qualified /
 * Needs review / Not qualified), derived from the run's own tool calls -
 * already streamed live to the run view - rather than from new counters.
 * Pure and browser-safe (no node imports).
 */

export interface PipelineToolCall {
  tool_name: string;
  status: string;
  result_data: unknown;
}

export interface Pipeline {
  discovered: number;
  /** Null for runs whose discovery predates the size/location prefilter - there's nothing to count. */
  kept: number | null;
  scraped: number;
  qualified: number;
  needsReview: number;
  notQualified: number;
}

function hostOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function domainOf(value: unknown): string | null {
  return typeof value === "string" ? hostOf(value) ?? value.toLowerCase() : null;
}

/**
 * `reviewerDecisions`: domain -> status for leads a reviewer decided. Those
 * decisions aren't tool calls, so they're passed in and win over whatever
 * the agent saved.
 */
export function derivePipeline(toolCalls: PipelineToolCall[], fallbackCandidatesSeen = 0, reviewerDecisions: Record<string, string> = {}): Pipeline {
  let discovered = 0;
  let kept: number | null = 0;
  let sawDiscovery = false;
  const scraped = new Set<string>();
  /** Latest decision per company - a re-saved lead replaces its earlier status. */
  const leadStatus = new Map<string, string>();

  for (const call of toolCalls) {
    if (call.status !== "ok") continue;
    const data = call.result_data as Record<string, unknown> | unknown[] | null;

    if (call.tool_name === "discover_companies") {
      sawDiscovery = true;
      if (data && !Array.isArray(data) && Array.isArray(data.candidates)) {
        discovered += typeof data.itemCount === "number" ? data.itemCount : 0;
        if (kept !== null) kept += data.candidates.length;
      } else {
        // Older runs stored a plain candidate array, with no prefilter.
        discovered += Array.isArray(data) ? data.length : 0;
        kept = null;
      }
    }

    if (call.tool_name === "scrape_site" && data && !Array.isArray(data)) {
      const domain = domainOf(data.candidateDomain) ?? hostOf(data.url);
      if (domain) scraped.add(domain);
    }

    if (call.tool_name === "save_lead" && data && !Array.isArray(data)) {
      const domain = domainOf(data.company_domain);
      if (domain && typeof data.qualification_status === "string") leadStatus.set(domain, data.qualification_status);
    }
  }

  for (const [domain, status] of Object.entries(reviewerDecisions)) leadStatus.set(domainOf(domain) ?? domain, status);
  const statuses = [...leadStatus.values()];
  return {
    discovered: sawDiscovery ? discovered : fallbackCandidatesSeen,
    kept: sawDiscovery ? kept : null,
    scraped: scraped.size,
    qualified: statuses.filter((s) => s === "qualified").length,
    needsReview: statuses.filter((s) => s === "needs_review").length,
    notQualified: statuses.filter((s) => s === "not_qualified").length,
  };
}
