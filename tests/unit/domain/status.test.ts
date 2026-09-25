import { describe, expect, it } from "vitest";
import { RUN_STATUS, LEAD_STATUS, TOOL_CALL_STATUS, VALIDATION_VERDICT } from "@core/domain/status";

// One registry, one place: SYSTEM-DESIGN-NEXTJS.md §17.2 "Status rendering
// has a single source of truth" - every status maps to a label, an icon,
// and a tone, and nothing else in the app may hardcode one.
describe("status registries", () => {
  it("RUN_STATUS covers exactly the nine states in the run lifecycle (§6, plus paused)", () => {
    expect(Object.keys(RUN_STATUS).sort()).toEqual(
      ["draft", "queued", "running", "awaiting_input", "paused", "completed", "partial", "failed", "cancelled"].sort(),
    );
  });

  it("LEAD_STATUS covers exactly the three qualification statuses", () => {
    expect(Object.keys(LEAD_STATUS).sort()).toEqual(["qualified", "not_qualified", "needs_review"].sort());
  });

  it("TOOL_CALL_STATUS covers exactly the five tool-call outcomes", () => {
    expect(Object.keys(TOOL_CALL_STATUS).sort()).toEqual(["ok", "error", "denied", "cache_hit", "sent_back"].sort());
  });

  it("VALIDATION_VERDICT covers exactly the seven objective-validation verdicts (§7.2, §13)", () => {
    expect(Object.keys(VALIDATION_VERDICT).sort()).toEqual(
      ["valid", "vague", "incoherent", "not_a_request", "out_of_scope", "out_of_scope_unsafe", "unavailable"].sort(),
    );
  });

  for (const [registryName, registry] of Object.entries({
    RUN_STATUS,
    LEAD_STATUS,
    TOOL_CALL_STATUS,
    VALIDATION_VERDICT,
  })) {
    it(`every entry in ${registryName} has a non-empty label, icon, and tone`, () => {
      for (const [key, entry] of Object.entries(registry as Record<string, { label: string; icon: string; tone: string }>)) {
        expect(entry.label, `${registryName}.${key}.label`).toBeTruthy();
        expect(entry.icon, `${registryName}.${key}.icon`).toBeTruthy();
        expect(entry.tone, `${registryName}.${key}.tone`).toBeTruthy();
      }
    });
  }

  it("out_of_scope_unsafe is the only non-dismissible verdict tone (danger) that also blocks submission", () => {
    // Encodes §7.2's rule at the type level: this is asserted properly by
    // the validation gate in Task 8, but the registry itself should at
    // least mark it distinctly from the merely-advisory verdicts.
    expect(VALIDATION_VERDICT.out_of_scope_unsafe.tone).toBe("danger");
    expect(VALIDATION_VERDICT.valid.tone).not.toBe("danger");
  });
});
