import { errorMessage } from "@core/domain/errors";

/**
 * Retries a Gemini call on rate limits (429) and temporary server errors
 * (500/503), waiting as long as the API itself asks. A per-minute quota
 * clears by waiting; failing the whole run on it - what happened live,
 * one 429 on `GenerateContentInputTokensPerModelPerMinute-FreeTier` -
 * throws away every lead found so far. A per-day quota does not clear in
 * any reasonable wait, so it fails immediately with a clear message.
 */

export interface RetryDecision {
  retryable: boolean;
  /** Milliseconds to wait before the next attempt. */
  delayMs: number;
  reason: string;
}

const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const MAX_DELAY_MS = 90_000;

export function statusOf(err: unknown): number | null {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") return status;
  const message = errorMessage(err);
  const match = message.match(/"code"\s*:\s*(\d{3})/) ?? message.match(/\b(429|500|503)\b/);
  return match ? Number(match[1]) : null;
}

/** Reads the server's own wait hint: `"retryDelay":"25s"` in the error details, or "retry in 25.6s" in the message. */
export function retryDelayHintMs(message: string): number | null {
  const detail = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (detail) return Math.ceil(Number(detail[1]) * 1000);
  const prose = message.match(/retry in (\d+(?:\.\d+)?)s/i);
  return prose ? Math.ceil(Number(prose[1]) * 1000) : null;
}

export function classifyGeminiError(err: unknown, attempt: number): RetryDecision {
  const message = errorMessage(err);
  const status = statusOf(err);

  if (status === null || !RETRYABLE_STATUSES.has(status)) {
    return { retryable: false, delayMs: 0, reason: `not a retryable error (${status ?? "no status"})` };
  }
  if (status === 429 && /PerDay/i.test(message)) {
    return { retryable: false, delayMs: 0, reason: "daily Gemini quota exhausted - waiting won't clear it" };
  }

  // Exponential fallback (2s, 4s, 8s, ...) when the API gives no hint; a
  // small margin on top of a hint, since retrying at exactly the reset
  // moment can land just before it.
  const hint = retryDelayHintMs(message);
  const delayMs = Math.min(MAX_DELAY_MS, hint !== null ? hint + 1_000 : 2_000 * 2 ** (attempt - 1));
  return { retryable: true, delayMs, reason: status === 429 ? "rate limited" : `server error ${status}` };
}

export interface RetryOptions {
  maxAttempts?: number;
  /** Called before each wait - used to log the wait on the run's event stream. */
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => Promise<void> | void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withGeminiRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const decision = classifyGeminiError(err, attempt);
      if (!decision.retryable || attempt >= maxAttempts) throw err;
      await options.onRetry?.({ attempt, delayMs: decision.delayMs, reason: decision.reason });
      await sleep(decision.delayMs);
    }
  }
}
