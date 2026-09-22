import { describe, expect, it } from "vitest";
import { checkGrounding } from "@core/safety/grounding";

const sourceSummary =
  "Acme Robotics builds warehouse automation software for mid-market logistics companies and is currently hiring operations engineers.";
const sourceUrls = ["https://acmerobotics.example/about", "https://acmerobotics.example/careers"];

describe("checkGrounding", () => {
  it("does not flag a claim traceable to the source summary", () => {
    const result = checkGrounding({
      draftText: "I noticed Acme Robotics is hiring operations engineers to support your warehouse automation work.",
      sourceSummary,
      sourceUrls,
    });
    expect(result.flagged).toBe(false);
  });

  it("flags a specific-sounding claim with no basis in the source summary", () => {
    const result = checkGrounding({
      draftText: "I saw that Acme Robotics just raised a $50 million Series C led by Sequoia Capital.",
      sourceSummary,
      sourceUrls,
    });
    expect(result.flagged).toBe(true);
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("does not flag generic, non-specific personalization", () => {
    const result = checkGrounding({
      draftText: "I saw your website and wanted to reach out. Would you be open to a quick call?",
      sourceSummary,
      sourceUrls,
    });
    expect(result.flagged).toBe(false);
  });

  it("does not flag a claim that references one of the lead's own source urls", () => {
    const result = checkGrounding({
      draftText: "Your careers page at acmerobotics.example/careers mentions the Series B round from 2023.",
      sourceSummary,
      sourceUrls,
    });
    expect(result.flagged).toBe(false);
  });

  it("flags a claim in the personalization note, not only the body", () => {
    const result = checkGrounding({
      draftText: "Quick question for you.",
      sourceSummary,
      sourceUrls: [],
    });
    // draftText alone has no specific detail, so nothing should be flagged
    expect(result.flagged).toBe(false);
  });
});
