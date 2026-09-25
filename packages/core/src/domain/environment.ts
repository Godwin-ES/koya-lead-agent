/**
 * Deployed vs local. Keyed on an explicit APP_ENV=production (the worker
 * image and the Vercel project set it; NEXT_PUBLIC_APP_ENV is the same
 * flag for the browser bundle), not NODE_ENV: a local `next start` and the
 * Playwright suite also run production builds, and they keep the local
 * behaviour - replay by default, the runner/model/scraper pickers, Gemini
 * and Crawl4AI.
 */
export function isProduction(): boolean {
  return process.env.APP_ENV === "production" || process.env.NEXT_PUBLIC_APP_ENV === "production";
}

/** The model for runs and drafting sessions in production. */
export function productionModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
}

/** The model for the objective check at intake. */
export function cheapModel(): string {
  return process.env.ANTHROPIC_CHEAP_MODEL || "claude-haiku-4-5";
}

/**
 * What a production run always uses, whatever a request asks for: Claude
 * through the Agent SDK, and Firecrawl (the worker image has no browser for
 * Crawl4AI). Gemini and Crawl4AI stay available locally.
 */
export function productionRunConfig(): { runner: "agent-sdk"; model: string; scraper: "firecrawl" } {
  return { runner: "agent-sdk", model: productionModel(), scraper: "firecrawl" };
}
