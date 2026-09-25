import type { Scraper } from "../../domain/types";

export interface ScrapeRequest {
  url: string;
  /** The candidate's own domain - `scrape()` refuses any url outside it (SYSTEM-DESIGN-NEXTJS.md §13). */
  candidateDomain: string;
}

export interface ScrapeSuccess {
  success: true;
  scraper: Scraper;
  url: string;
  finalUrl: string;
  httpStatus: number;
  title: string | null;
  contentMd: string;
  injectionFlagged: boolean;
}

export interface ScrapeFailure {
  success: false;
  scraper: Scraper;
  url: string;
  httpStatus: number | null;
  errorMessage: string;
  /** The scraping service itself failed (server error, no response) after its retry - not the website. */
  providerError?: boolean;
}

export type ScrapeResult = ScrapeSuccess | ScrapeFailure;

/** What each provider adapter (crawl4ai.ts, firecrawl.ts) returns before the shared normalize/scan/truncate pipeline in index.ts runs. */
export type RawScrapeResult =
  | { success: true; httpStatus: number; title: string | null; contentMd: string; finalUrl: string }
  | { success: false; httpStatus: number | null; errorMessage: string; providerError?: boolean };
