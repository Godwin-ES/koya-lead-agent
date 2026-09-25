/**
 * Why a run can't carry on, sorted by what fixes it:
 * - temporary: a timeout, rate limit, overloaded or unreachable provider.
 *   Waiting fixes it - the worker resumes the run on its own a few times.
 * - account: a bad key, no credits, a used-up quota. Someone has to fix the
 *   account; retrying just burns attempts. Resume works once it's fixed.
 * - bug: anything else - our own code or an input the provider rejected.
 *
 * Both runners stop a run the same way when a tool or the model raises one
 * of these, and the worker decides what happens next from `kind`.
 */
export type FailureKind = "temporary" | "account" | "bug";
export type FailureProvider = "anthropic" | "gemini" | "apify" | "firecrawl" | "crawl4ai" | "supabase" | "worker";

export class RunFailure extends Error {
  constructor(
    public readonly kind: FailureKind,
    public readonly provider: FailureProvider,
    message: string,
  ) {
    super(message);
    this.name = "RunFailure";
  }
}

const PROVIDER_LABEL: Record<FailureProvider, string> = {
  anthropic: "Claude",
  gemini: "Gemini",
  apify: "Apify",
  firecrawl: "Firecrawl",
  crawl4ai: "Crawl4AI",
  supabase: "the database",
  worker: "the worker",
};

export function providerLabel(provider: FailureProvider): string {
  return PROVIDER_LABEL[provider];
}

const OUT_OF_CREDIT = /credit|insufficient|quota|usage limit|hard limit|billing|payment|exceeded your|not enough usage/i;

/**
 * An API-level HTTP failure from a provider (not a target website's own
 * status - a scraped page returning 404 is evidence, not a failure).
 * `status` null means no response at all: a timeout or network error.
 */
export function classifyHttpFailure(provider: FailureProvider, status: number | null, detail: string): RunFailure {
  const name = providerLabel(provider);
  if (status === 401 || status === 403) {
    return new RunFailure("account", provider, `${name} rejected the API key (HTTP ${status}) - check the key in the worker's settings. ${detail}`.trim());
  }
  if (status === 402 || (status !== null && status < 500 && status !== 429 && OUT_OF_CREDIT.test(detail))) {
    return new RunFailure("account", provider, `${name} is out of credits or over its usage limit - top up the account, then resume. ${detail}`.trim());
  }
  if (status === null || status === 408 || status === 429 || status >= 500) {
    const what = status === null ? "didn't respond (timeout or network error)" : status === 429 ? "is rate-limiting requests" : `had a server error (HTTP ${status})`;
    return new RunFailure("temporary", provider, `${name} ${what}. ${detail}`.trim());
  }
  return new RunFailure("bug", provider, `${name} rejected the request (HTTP ${status}). ${detail}`.trim());
}

/** The error types the Agent SDK tags a failed Claude API call with (SDKAssistantMessageError). */
const SDK_ACCOUNT_ERRORS = new Set(["authentication_failed", "oauth_org_not_allowed", "account_on_hold", "verification_required", "billing_error", "cloud_credential_error"]);
const SDK_TEMPORARY_ERRORS = new Set(["rate_limit", "overloaded", "server_error"]);

export function classifySdkError(error: string, detail = ""): RunFailure {
  const suffix = detail ? ` ${detail}` : "";
  if (SDK_ACCOUNT_ERRORS.has(error)) {
    const what = error === "billing_error" ? "is out of credits or has a billing problem" : "rejected the API key or account";
    return new RunFailure("account", "anthropic", `Claude ${what} (${error}) - fix the Anthropic account, then resume.${suffix}`);
  }
  if (SDK_TEMPORARY_ERRORS.has(error)) {
    return new RunFailure("temporary", "anthropic", `Claude is ${error === "rate_limit" ? "rate-limiting requests" : error === "overloaded" ? "overloaded" : "having server errors"} (${error}).${suffix}`);
  }
  return new RunFailure("bug", "anthropic", `Claude request failed (${error}).${suffix}`);
}

/** How long before each automatic resume of a temporary failure; its length is how many there are. */
export const AUTO_RESUME_DELAYS_MS = [2 * 60_000, 10 * 60_000];

/** When to resume a run automatically after a temporary failure, or null once the automatic resumes are used up. */
export function nextAutoResumeDelay(autoResumesSoFar: number): number | null {
  return AUTO_RESUME_DELAYS_MS[autoResumesSoFar] ?? null;
}

/** Retries `fn` once after `delayMs` when it throws a temporary RunFailure. */
export async function retryTemporaryOnce<T>(fn: () => Promise<T>, delayMs = 3_000): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof RunFailure) || err.kind !== "temporary") throw err;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fn();
  }
}
