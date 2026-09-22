import { normalizeDomain, hashObjective } from "../../domain/normalize";
import { withRecording } from "../replay/recorder";
import { scanForInjection } from "../../safety/injection";
import { scrapeCrawl4aiRaw } from "./crawl4ai";
import { scrapeFirecrawlRaw } from "./firecrawl";
import type { ScrapeRequest, ScrapeResult, RawScrapeResult } from "./types";
import type { Scraper } from "../../domain/types";

export * from "./types";

function assertDomainScope(request: ScrapeRequest): void {
  const targetDomain = normalizeDomain(request.url);
  const candidateDomain = normalizeDomain(request.candidateDomain);

  const inScope = targetDomain === candidateDomain || targetDomain.endsWith(`.${candidateDomain}`);
  if (!inScope) {
    throw new Error(`domain scope violation: ${request.url} is outside candidate domain ${request.candidateDomain}`);
  }
}

export interface ScrapeOptions {
  scraper?: Scraper;
}

/**
 * The one scraper entry point every caller uses - selects the adapter,
 * enforces that a scrape can never leave the candidate's own domain
 * (SYSTEM-DESIGN-NEXTJS.md §13), routes the raw call through the
 * recorder so it's replay-safe like every other external call (§11), and
 * runs the injection scan on whatever text comes back. Does not write to
 * `scrape_cache` or `cost_ledger` itself - same split as
 * `discovery/apify.ts`'s `discover()`, Task 12's `scrape_site` tool
 * handler owns persistence.
 */
export async function scrape(request: ScrapeRequest, options: ScrapeOptions = {}): Promise<ScrapeResult> {
  assertDomainScope(request);

  const scraper: Scraper = options.scraper ?? (process.env.SCRAPER_DEFAULT === "firecrawl" ? "firecrawl" : "crawl4ai");
  const dispatch = scraper === "firecrawl" ? scrapeFirecrawlRaw : scrapeCrawl4aiRaw;

  const fixtureKey = `scraper:${scraper}:${hashObjective(request.url)}`;
  const raw = await withRecording<RawScrapeResult>(fixtureKey, () => dispatch(request.url));

  if (!raw.success) {
    return { success: false, scraper, url: request.url, httpStatus: raw.httpStatus, errorMessage: raw.errorMessage };
  }

  const { flagged } = scanForInjection(raw.contentMd);

  return {
    success: true,
    scraper,
    url: request.url,
    finalUrl: raw.finalUrl,
    httpStatus: raw.httpStatus,
    title: raw.title,
    contentMd: raw.contentMd,
    injectionFlagged: flagged,
  };
}
