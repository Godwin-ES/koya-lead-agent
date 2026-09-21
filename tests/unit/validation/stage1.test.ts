import { describe, expect, it } from "vitest";
import { stage1 } from "@core/validation/stage1";

/**
 * SYSTEM-DESIGN-NEXTJS.md §7.1: deterministic, free, no model call.
 * Stage 1 failures never reach the classifier.
 */
describe("stage1", () => {
  it.each([
    ["", "too_short"],
    ["find", "too_short"],
    ["asdkjhasdkjh", "gibberish"],
    ["https://example.com", "bare_url"],
    ["!!!!!!!!!!!!", "no_alpha"],
  ])("rejects %j as %s", (input, code) => {
    const result = stage1(input);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe(code);
  });

  it("passes a plausible objective through to stage 2", () => {
    expect(stage1("Find 10 US B2B SaaS companies with 10 to 100 employees").ok).toBe(true);
  });

  it("rejects an objective over the 1000-char maximum", () => {
    const result = stage1("Find 10 US B2B SaaS companies. ".repeat(50));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("too_long");
  });

  it("rejects a bare email address the same as a bare URL", () => {
    const result = stage1("founder@example-startup.com");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("bare_url");
  });

  it("rejects a keyboard-mash pattern as gibberish", () => {
    const result = stage1("qwertyuiop asdfghjkl zxcvbnm qwertyuiop");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("gibberish");
  });

  it("rejects text with no word longer than three characters", () => {
    const result = stage1("the top ten biz ppl are all set to go and win big now for out use own two six via lot key");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("too_short");
  });

  it("passes a specific, narrow, valid-looking objective", () => {
    expect(stage1("Find US fintech companies in the 10-50 employee range that recently raised a seed round").ok).toBe(
      true,
    );
  });
});
