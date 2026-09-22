import type { RawScrapeResult } from "./types";

/**
 * Calls the hosted Firecrawl API - the deployed-default scraper
 * (SYSTEM-DESIGN-NEXTJS.md §4.4). Unlike crawl4ai.ts, this shape has
 * **not** been confirmed with a live call (no live Firecrawl test has run
 * in this project yet - dev uses crawl4ai per §4.4, and this path only
 * activates on deployment). Written from Firecrawl's documented v1
 * `/v1/scrape` API: `POST` with `{ url, formats: ["markdown"] }`, a 200
 * response wraps the real page result in `data`, and the *scraped page's*
 * status lives at `data.metadata.statusCode` - the API call itself can
 * return 200 for a page that 404'd, so success must check that field, not
 * just the HTTP response code, mirroring crawl4ai's own status_code
 * pattern. Flagged as a residual limitation in BUILD-NOTES-NEXTJS.md:
 * confirm this shape with one real call before Task 16's deploy.
 */
export async function scrapeFirecrawlRaw(url: string): Promise<RawScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not set - see .env.example.");
  }

  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  });

  if (!res.ok) {
    return { success: false, httpStatus: res.status, errorMessage: `firecrawl request failed with HTTP ${res.status}` };
  }

  const body = (await res.json()) as {
    success?: boolean;
    error?: string;
    data?: {
      markdown?: string;
      metadata?: { title?: string; statusCode?: number; sourceURL?: string };
    };
  };

  if (body.success === false || !body.data) {
    return { success: false, httpStatus: null, errorMessage: body.error ?? "firecrawl returned no data" };
  }

  const statusCode = body.data.metadata?.statusCode ?? null;
  const ok = statusCode === null || statusCode < 400;

  if (!ok) {
    return { success: false, httpStatus: statusCode, errorMessage: `firecrawl reported page status ${String(statusCode)}` };
  }

  return {
    success: true,
    httpStatus: statusCode ?? 200,
    title: body.data.metadata?.title ?? null,
    contentMd: body.data.markdown ?? "",
    finalUrl: body.data.metadata?.sourceURL ?? url,
  };
}
