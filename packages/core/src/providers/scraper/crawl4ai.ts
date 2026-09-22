import type { RawScrapeResult } from "./types";

/**
 * Calls the self-hosted Crawl4AI sidecar. Shape confirmed live
 * (app/docs/provider-findings.md, Task 1 Step 4): `POST /crawl` (never
 * `/md` - its response carries no HTTP status, so a 404/block/redirect is
 * indistinguishable from a real scrape), `results[0]`, success requires
 * both `success === true` and `status_code < 400`, content prefers
 * `markdown.fit_markdown` and falls back to `markdown.raw_markdown`.
 */
export async function scrapeCrawl4aiRaw(url: string): Promise<RawScrapeResult> {
  const baseUrl = process.env.CRAWL4AI_BASE_URL ?? "http://localhost:11235";
  const token = process.env.CRAWL4AI_API_TOKEN;

  const res = await fetch(`${baseUrl}/crawl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ urls: [url] }),
  });

  if (!res.ok) {
    return { success: false, httpStatus: res.status, errorMessage: `crawl4ai request failed with HTTP ${res.status}` };
  }

  const body = (await res.json()) as {
    results?: Array<{
      success?: boolean;
      status_code?: number;
      error_message?: string;
      redirected_url?: string;
      metadata?: { title?: string };
      markdown?: { fit_markdown?: string; raw_markdown?: string };
    }>;
  };

  const result = body.results?.[0];
  if (!result) {
    return { success: false, httpStatus: null, errorMessage: "crawl4ai returned no results for this url" };
  }

  const statusCode = result.status_code ?? null;
  const ok = result.success === true && statusCode !== null && statusCode < 400;

  if (!ok) {
    return {
      success: false,
      httpStatus: statusCode,
      errorMessage: result.error_message ?? `crawl4ai reported status ${String(statusCode)}`,
    };
  }

  return {
    success: true,
    httpStatus: statusCode,
    title: result.metadata?.title ?? null,
    contentMd: result.markdown?.fit_markdown || result.markdown?.raw_markdown || "",
    finalUrl: result.redirected_url ?? url,
  };
}
