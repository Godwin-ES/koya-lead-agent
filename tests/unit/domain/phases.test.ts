import { describe, expect, it } from "vitest";
import { derivePhases } from "@core/domain/phases";

const base = {
  status: "queued" as const,
  hasIcp: false,
  candidatesSeen: 0,
  scrapesUsed: 0,
  hasLeads: false,
  hasDrafts: false,
};

describe("derivePhases", () => {
  it("validate is always done, even for a freshly queued run", () => {
    expect(derivePhases(base).validate).toBe("done");
  });

  it("marks the first not-yet-done phase current only while running", () => {
    const phases = derivePhases({ ...base, status: "running" });
    expect(phases.icp).toBe("current");
    expect(phases.discover).toBe("pending");
  });

  it("does not mark any phase current for a queued run", () => {
    const phases = derivePhases({ ...base, status: "queued" });
    expect(Object.values(phases)).not.toContain("current");
  });

  it("marks phases done in order as real evidence accumulates", () => {
    const phases = derivePhases({
      status: "running",
      hasIcp: true,
      candidatesSeen: 5,
      scrapesUsed: 3,
      hasLeads: false,
      hasDrafts: false,
    });
    expect(phases.icp).toBe("done");
    expect(phases.discover).toBe("done");
    expect(phases.scrape).toBe("done");
    expect(phases.qualify).toBe("current");
    expect(phases.draft).toBe("pending");
  });

  it("marks finalize done only for a terminal status", () => {
    expect(derivePhases({ ...base, status: "completed" }).finalize).toBe("done");
    expect(derivePhases({ ...base, status: "partial" }).finalize).toBe("done");
    expect(derivePhases({ ...base, status: "failed" }).finalize).toBe("done");
    expect(derivePhases({ ...base, status: "cancelled" }).finalize).toBe("done");
    expect(derivePhases({ ...base, status: "running" }).finalize).not.toBe("done");
  });

  it("never advances on anything but real recorded evidence", () => {
    // A "running" status with zero real signals still shows every
    // downstream phase as pending, not advancing just because time
    // has passed - there is no timer input to this function at all.
    const phases = derivePhases({ ...base, status: "running" });
    expect(phases.discover).toBe("pending");
    expect(phases.scrape).toBe("pending");
    expect(phases.qualify).toBe("pending");
  });
});
