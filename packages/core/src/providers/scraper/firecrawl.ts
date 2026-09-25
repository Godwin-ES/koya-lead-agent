import type { RawScrapeResult } from "./types";
import { classifyHttpFailure, RunFailure } from "../../domain/failure";

/**
 * Calls the hosted Firecrawl API - the production scraper. `POST
 * /v1/scrape` with `{ url, formats: ["markdown"] }`; a 200 response wraps
 * the page in `data`, and the *scraped page's* status is
 * `data.metadata.statusCode`. Confirmed live (2026-09-25): a missing page
 * came back HTTP 200, `success: true`, `statusCode: 404` - so success
 * checks that field, not the HTTP status. `metadata.url` is the final
 * address after redirects; `sourceURL` is the one requested.
 *
 * Errors, by what they mean:
 * - 401 / 402: the account (bad key, no credits) - thrown as a RunFailure
 *   that stops the run, since every later page would fail the same way.
 * - 429: rate-limited - waits and retries, then stops the run as temporary.
 * - 5xx, 408, timeout, no response: often one hard website, sometimes
 *   Firecrawl itself. One retry, then the page counts as unscrapable
 *   (`providerError: true`); scrape_site stops the run as temporary when
 *   several pages in a row fail this way.
 * - anything else: the page couldn't be scraped - evidence for needs_review.
 */
const REQUEST_TIMEOUT_MS = 60_000;
/** Firecrawl's own per-page limit, inside the request timeout. */
const PAGE_TIMEOUT_MS = 45_000;
const RATE_LIMIT_RETRIES = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function bodyText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

export async function scrapeFirecrawlRaw(url: string): Promise<RawScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new RunFailure("account", "firecrawl", "FIRECRAWL_API_KEY is not set on the worker.");
  }

  let serverRetried = false;
  for (let rateLimited = 0; ; ) {
    let res: Response;
    try {
      res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ url, formats: ["markdown"], timeout: PAGE_TIMEOUT_MS }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (!serverRetried) {
        serverRetried = true;
        await sleep(2_000);
        continue;
      }
      const why = err instanceof Error && err.name === "TimeoutError" ? `no response within ${REQUEST_TIMEOUT_MS / 1000}s` : "network error";
      return { success: false, httpStatus: null, errorMessage: `firecrawl: ${why}`, providerError: true };
    }

    if (res.status === 401 || res.status === 402) {
      throw classifyHttpFailure("firecrawl", res.status, await bodyText(res));
    }
    if (res.status === 429) {
      if (rateLimited < RATE_LIMIT_RETRIES) {
        rateLimited += 1;
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5_000 * rateLimited);
        continue;
      }
      throw classifyHttpFailure("firecrawl", 429, await bodyText(res));
    }
    if (res.status >= 500 || res.status === 408) {
      if (!serverRetried) {
        serverRetried = true;
        await sleep(2_000);
        continue;
      }
      return { success: false, httpStatus: res.status, errorMessage: `firecrawl request failed with HTTP ${res.status}: ${await bodyText(res)}`, providerError: true };
    }
    if (!res.ok) {
      return { success: false, httpStatus: res.status, errorMessage: `firecrawl request failed with HTTP ${res.status}: ${await bodyText(res)}` };
    }

    const body = (await res.json()) as {
      success?: boolean;
      error?: string;
      data?: { markdown?: string; metadata?: { title?: string; statusCode?: number; sourceURL?: string; url?: string } };
    };

    if (body.success === false || !body.data) {
      return { success: false, httpStatus: null, errorMessage: body.error ?? "firecrawl returned no data" };
    }

    const statusCode = body.data.metadata?.statusCode ?? null;
    if (statusCode !== null && statusCode >= 400) {
      return { success: false, httpStatus: statusCode, errorMessage: `firecrawl reported page status ${String(statusCode)}` };
    }

    return {
      success: true,
      httpStatus: statusCode ?? 200,
      title: body.data.metadata?.title ?? null,
      contentMd: body.data.markdown ?? "",
      finalUrl: body.data.metadata?.url ?? body.data.metadata?.sourceURL ?? url,
    };
  }
}
