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

  describe("the company's own name", () => {
    const source = "Health Samurai builds Aidbox, a FHIR platform for healthcare developers.";
    const companyNames = ["Health Samurai"];

    // Live: this follow-up line was flagged only because it named the company.
    it("doesn't make a follow-up, conditional or question a claim", () => {
      for (const sentence of [
        "If this isn't the right time for Health Samurai to look at AI automation support, no problem at all - a short reply either way is appreciated, and I'm glad to reconnect later if useful.",
        "Is manual onboarding still a bottleneck at Health Samurai?",
        "A Koya Talent assistant could take that work off the Health Samurai team.",
      ]) {
        expect(checkGrounding({ draftText: sentence, sourceSummary: source, sourceUrls: [], ignoreNames: ["Koya Talent"], companyNames }).flagged, sentence).toBe(false);
      }
    });

    it("still checks a sentence that states something about the company", () => {
      const result = checkGrounding({ draftText: "Health Samurai still handles insurance claims manually across three offices.", sourceSummary: source, sourceUrls: [], companyNames });
      expect(result.flagged).toBe(true);
    });

    it("doesn't flag a stated fact the sources back", () => {
      const result = checkGrounding({ draftText: "Health Samurai builds Aidbox, a FHIR platform for healthcare developers.", sourceSummary: source, sourceUrls: [], companyNames });
      expect(result.flagged).toBe(false);
    });
  });
});
