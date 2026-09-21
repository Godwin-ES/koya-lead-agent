import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { IcpSchema } from "@core/schemas/icp";
import { QualificationSchema } from "@core/schemas/qualification";
import { ValidationVerdictSchema } from "@core/schemas/validation";

// tests/contract/ -> app/ -> week-5/ (SYSTEM-DESIGN-NEXTJS.md and the
// aat-c3-week-5-lead-agent/ assets both live in week-5/, one level above
// the isolated app/ repository - see IMPLEMENTATION-PLAN-NEXTJS.md's
// Global Constraints).
const weekFiveDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Extracts the key set of the first fenced ```json object in a Markdown
 * file. This is what stops skill text and tool validation from drifting
 * apart later (IMPLEMENTATION-PLAN-NEXTJS.md Task 3, Step 3): the schema a
 * tool validates against and the JSON shape a skill tells the agent to
 * produce must always agree, because both come from the same source guide.
 */
function extractJsonBlockKeys(filePath: string): string[] {
  const text = readFileSync(filePath, "utf-8");
  const match = text.match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw new Error(`No fenced json block found in ${filePath}`);
  const parsed = JSON.parse(match[1]!);
  return Object.keys(parsed);
}

// Only these three sources publish an exact JSON contract. The remaining
// two guides (outbound-copywriting, lead-list-quality) describe their
// required output in prose and tables, not a fenced JSON block - their
// schemas (outreach.ts, quality.ts) are still written directly from that
// guide content, they just have no literal block to diff against here.
describe("schema contract: guide JSON blocks match their Zod schema exactly", () => {
  it("icp.ts matches assets/icp-refinement-guide.md's ICP object", () => {
    const guideKeys = extractJsonBlockKeys(
      path.join(weekFiveDir, "aat-c3-week-5-lead-agent/assets/icp-refinement-guide.md"),
    );
    const schemaKeys = Object.keys(IcpSchema.shape);
    expect(schemaKeys.sort()).toEqual(guideKeys.sort());
  });

  it("qualification.ts matches assets/lead-qualification-guide.md's decision object", () => {
    const guideKeys = extractJsonBlockKeys(
      path.join(weekFiveDir, "aat-c3-week-5-lead-agent/assets/lead-qualification-guide.md"),
    );
    const schemaKeys = Object.keys(QualificationSchema.shape);
    expect(schemaKeys.sort()).toEqual(guideKeys.sort());
  });

  it("validation.ts matches SYSTEM-DESIGN-NEXTJS.md §7.1's classifier result object", () => {
    const guideKeys = extractJsonBlockKeys(path.join(weekFiveDir, "SYSTEM-DESIGN-NEXTJS.md"));
    const schemaKeys = Object.keys(ValidationVerdictSchema.shape);
    expect(schemaKeys.sort()).toEqual(guideKeys.sort());
  });
});
