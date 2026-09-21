import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { classifyObjective } from "@core/validation/classifier";
import { saveFixture, fixturePathFor } from "@core/providers/replay/fixtures";
import { hashObjective } from "@core/domain/normalize";

/**
 * classifyObjective goes through withRecording (Task 7) like every other
 * external call - these tests never touch a real model, matching the
 * project-wide "no automated test spends real credits" constraint.
 */
describe("classifyObjective", () => {
  const objective = "Find 10 US B2B SaaS companies with 10 to 100 employees";
  const key = `classifier:objective:${hashObjective(objective)}`;
  const previousReplayMode = process.env.REPLAY_MODE;

  beforeAll(() => {
    process.env.REPLAY_MODE = "true";
  });

  afterAll(() => {
    process.env.REPLAY_MODE = previousReplayMode;
    const filePath = fixturePathFor(key);
    if (existsSync(filePath)) rmSync(filePath);
  });

  it("fails loudly with no recorded fixture, never making a live call", async () => {
    await expect(classifyObjective(objective)).rejects.toThrow(/fixture missing/i);
  });

  it("returns the recorded verdict, validated against the schema, once a fixture exists", async () => {
    saveFixture(key, {
      verdict: "valid",
      confidence: 0.92,
      reason: "Specific industry, size range, and geography given.",
      missing_criteria: [],
      suggested_rewrite: "",
    });

    const result = await classifyObjective(objective);
    expect(result.verdict).toBe("valid");
    expect(result.confidence).toBeCloseTo(0.92);
  });

  it("throws if the fixture doesn't match the schema (a corrupted or hand-edited fixture)", async () => {
    saveFixture(key, { verdict: "not_a_real_verdict", confidence: 2 });
    await expect(classifyObjective(objective)).rejects.toThrow();
  });
});
