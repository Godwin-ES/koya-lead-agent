import { describe, expect, it, vi } from "vitest";
import { classifyGeminiError, retryDelayHintMs, withGeminiRetry } from "../../../worker/src/runners/gemini-retry";

/** The exact error body from the live run that failed (2026-09-24), trimmed to the fields the classifier reads. */
const LIVE_PER_MINUTE_429 = JSON.stringify({
  error: {
    code: 429,
    message:
      "You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 250000, model: gemini-3.5-flash-lite\nPlease retry in 25.60987624s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateContentInputTokensPerModelPerMinute-FreeTier" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "25s" },
    ],
  },
});

function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

describe("classifyGeminiError", () => {
  it("retries the live per-minute 429 after the server's own delay, plus a margin", () => {
    expect(classifyGeminiError(apiError(429, LIVE_PER_MINUTE_429), 1)).toEqual({ retryable: true, delayMs: 26_000, reason: "rate limited" });
  });

  it("finds the status in the message when the error object has none", () => {
    expect(classifyGeminiError(new Error(LIVE_PER_MINUTE_429), 1).retryable).toBe(true);
  });

  it("does not retry a daily quota - waiting won't clear it", () => {
    const daily = LIVE_PER_MINUTE_429.replace("PerMinute", "PerDay");
    expect(classifyGeminiError(apiError(429, daily), 1)).toMatchObject({ retryable: false, reason: expect.stringMatching(/daily/) });
  });

  it("retries 500/503 with exponential backoff when there's no hint", () => {
    expect(classifyGeminiError(apiError(503, "The model is overloaded."), 1)).toMatchObject({ retryable: true, delayMs: 2_000 });
    expect(classifyGeminiError(apiError(503, "The model is overloaded."), 3)).toMatchObject({ retryable: true, delayMs: 8_000 });
  });

  it("does not retry a request the API rejected (400)", () => {
    expect(classifyGeminiError(apiError(400, "Function call is missing a thought_signature"), 1).retryable).toBe(false);
  });
});

describe("retryDelayHintMs", () => {
  it("prefers the structured retryDelay, falls back to 'retry in Ns'", () => {
    expect(retryDelayHintMs('"retryDelay":"25s"')).toBe(25_000);
    expect(retryDelayHintMs("Please retry in 3.2s.")).toBe(3_200);
    expect(retryDelayHintMs("no hint")).toBeNull();
  });
});

describe("withGeminiRetry", () => {
  it("waits and retries a rate limit, then returns the successful result", async () => {
    const fn = vi.fn().mockRejectedValueOnce(apiError(429, LIVE_PER_MINUTE_429)).mockResolvedValueOnce("turn");
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    await expect(withGeminiRetry(fn, { sleep, onRetry })).resolves.toBe("turn");
    expect(sleep).toHaveBeenCalledWith(26_000);
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, delayMs: 26_000, reason: "rate limited" });
  });

  it("gives up after maxAttempts and rethrows the last error", async () => {
    const err = apiError(503, "overloaded");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withGeminiRetry(fn, { maxAttempts: 3, sleep: async () => undefined })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows a non-retryable error immediately", async () => {
    const fn = vi.fn().mockRejectedValue(apiError(400, "bad request"));
    await expect(withGeminiRetry(fn, { sleep: async () => undefined })).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
