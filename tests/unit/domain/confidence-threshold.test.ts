import { describe, expect, it } from "vitest";
import { applyConfidenceThreshold, confidenceLabel, MIN_QUALIFIED_CONFIDENCE } from "@core/schemas/qualification";

describe("applyConfidenceThreshold", () => {
  it("sends a low-confidence qualified verdict to a reviewer (the live CoreView case, 0.50)", () => {
    const result = applyConfidenceThreshold("qualified", 0.5);
    expect(result.status).toBe("needs_review");
    expect(result.reason).toContain("0.50");
  });

  it("keeps a qualified verdict at or above the threshold", () => {
    expect(applyConfidenceThreshold("qualified", MIN_QUALIFIED_CONFIDENCE)).toEqual({ status: "qualified", reason: null });
    expect(applyConfidenceThreshold("qualified", 0.9).status).toBe("qualified");
  });

  it("never changes a not_qualified or needs_review verdict", () => {
    expect(applyConfidenceThreshold("not_qualified", 0.2)).toEqual({ status: "not_qualified", reason: null });
    expect(applyConfidenceThreshold("needs_review", 0.1)).toEqual({ status: "needs_review", reason: null });
  });
});

describe("confidenceLabel", () => {
  it("shows a percentage for qualified and needs_review leads, and none for a rejection", () => {
    expect(confidenceLabel("qualified", 0.82)).toBe("82% confidence");
    expect(confidenceLabel("needs_review", 0.4)).toBe("40% confidence");
    expect(confidenceLabel("not_qualified", 0.95)).toBeNull();
  });
});
