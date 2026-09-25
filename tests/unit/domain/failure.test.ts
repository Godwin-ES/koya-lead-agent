import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyHttpFailure, classifySdkError, nextAutoResumeDelay, retryTemporaryOnce, RunFailure, AUTO_RESUME_DELAYS_MS } from "@core/domain/failure";

describe("classifyHttpFailure", () => {
  it("treats a rejected key or no credits as an account problem", () => {
    expect(classifyHttpFailure("firecrawl", 401, "").kind).toBe("account");
    expect(classifyHttpFailure("firecrawl", 402, "Payment required").kind).toBe("account");
    expect(classifyHttpFailure("apify", 403, "not-enough-usage-to-run-paid-actor").kind).toBe("account");
    expect(classifyHttpFailure("apify", 400, "Monthly usage hard limit exceeded").kind).toBe("account");
  });

  it("treats timeouts, rate limits and server errors as temporary", () => {
    expect(classifyHttpFailure("apify", null, "ETIMEDOUT").kind).toBe("temporary");
    expect(classifyHttpFailure("firecrawl", 429, "").kind).toBe("temporary");
    expect(classifyHttpFailure("apify", 503, "").kind).toBe("temporary");
  });

  it("treats any other rejection as a bug, naming the provider", () => {
    const failure = classifyHttpFailure("apify", 400, "invalid input: industryIds");
    expect(failure.kind).toBe("bug");
    expect(failure.message).toMatch(/^Apify rejected the request/);
  });
});

describe("classifySdkError", () => {
  it("sorts the Agent SDK's error types", () => {
    expect(classifySdkError("billing_error").kind).toBe("account");
    expect(classifySdkError("authentication_failed").kind).toBe("account");
    expect(classifySdkError("overloaded").kind).toBe("temporary");
    expect(classifySdkError("rate_limit").kind).toBe("temporary");
    expect(classifySdkError("server_error").kind).toBe("temporary");
    expect(classifySdkError("invalid_request").kind).toBe("bug");
  });
});

describe("automatic resume", () => {
  it("resumes a temporary failure twice, waiting longer the second time, then stops", () => {
    expect(nextAutoResumeDelay(0)).toBe(AUTO_RESUME_DELAYS_MS[0]);
    expect(nextAutoResumeDelay(1)).toBeGreaterThan(nextAutoResumeDelay(0)!);
    expect(nextAutoResumeDelay(2)).toBeNull();
  });
});

describe("retryTemporaryOnce", () => {
  afterEach(() => vi.useRealTimers());

  it("retries a temporary failure once", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new RunFailure("temporary", "apify", "503")).mockResolvedValueOnce("ok");
    await expect(retryTemporaryOnce(fn, 0)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never retries an account failure", async () => {
    const fn = vi.fn().mockRejectedValue(new RunFailure("account", "apify", "401"));
    await expect(retryTemporaryOnce(fn, 0)).rejects.toMatchObject({ kind: "account" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
