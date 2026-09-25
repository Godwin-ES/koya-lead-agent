import { describe, expect, it } from "vitest";
import { loadSkill, jsonKeysIn, buildSystemPrompt, SKILL_NAMES } from "@core/skills/loader";
import { QualificationSchema } from "@core/schemas/qualification";
import { IcpSchema } from "@core/schemas/icp";

describe("skill files", () => {
  it.each(SKILL_NAMES)("%s exists with frontmatter name and description", (n) => {
    const s = loadSkill(n);
    expect(s.frontmatter.name).toBe(n);
    expect(s.frontmatter.description.length).toBeGreaterThan(20);
  });

  it("the qualification skill's json block matches the qualification zod schema", () => {
    expect(jsonKeysIn(loadSkill("lead-qualification"))).toEqual(Object.keys(QualificationSchema.shape));
  });

  it("the icp skill's json block matches the icp zod schema", () => {
    expect(jsonKeysIn(loadSkill("icp-refinement"))).toEqual(Object.keys(IcpSchema.shape));
  });
});

describe("buildSystemPrompt", () => {
  it("both runners receive every skill body in their system prompt - the same rules from the first turn", () => {
    for (const runner of ["gemini", "agent-sdk"] as const) {
      const p = buildSystemPrompt({ runner });
      for (const n of SKILL_NAMES) expect(p).toContain(loadSkill(n).body.slice(0, 40));
    }
    expect(buildSystemPrompt({ runner: "agent-sdk" })).toBe(buildSystemPrompt({ runner: "gemini" }));
  });

  it("the safety skill is inlined for both runners", () => {
    for (const runner of ["gemini", "agent-sdk"] as const) {
      expect(buildSystemPrompt({ runner })).toContain("must not");
    }
  });
});
