import { describe, expect, it } from "vitest";
import { deriveRunActions } from "@core/domain/run-actions";
import type { Run, RunAction } from "@core/domain/types";

// Builds a minimal Run for a given status. `extra` overrides fields, matching
// the shape used throughout SYSTEM-DESIGN-NEXTJS.md §17.5's action matrix.
const run = (status: Run["status"], extra: Partial<Run> = {}): Run =>
  ({
    status,
    counters: { qualified_count: 0 },
    lead_count: 0,
    ...extra,
  }) as Run;

function expectEnabled(state: ReturnType<typeof deriveRunActions>[RunAction]) {
  expect(state.kind).toBe("enabled");
}

function expectHidden(state: ReturnType<typeof deriveRunActions>[RunAction]) {
  expect(state.kind).toBe("hidden");
}

function expectDisabledWithReason(state: ReturnType<typeof deriveRunActions>[RunAction]) {
  expect(state.kind).toBe("disabled");
  expect(state.kind === "disabled" && state.reason.length).toBeGreaterThan(0);
}

describe("deriveRunActions", () => {
  // --- the plan's own worked examples ---

  it("disables start with a reason while a run is queued", () => {
    const a = deriveRunActions(run("queued"));
    expect(a.start.kind).toBe("disabled");
    expect(a.start.kind === "disabled" && a.start.reason.length).toBeGreaterThan(0);
  });

  it("hides start on a terminal run and offers re-run instead", () => {
    const a = deriveRunActions(run("completed", { lead_count: 10, counters: { qualified_count: 10 } }));
    expect(a.start.kind).toBe("hidden");
    expect(a.rerun.kind).toBe("enabled");
  });

  it("enables answer-clarification only while awaiting input", () => {
    expect(deriveRunActions(run("awaiting_input")).answerClarification.kind).toBe("enabled");
    expect(deriveRunActions(run("running")).answerClarification.kind).toBe("hidden");
  });

  it("never enables export before any lead exists", () => {
    const a = deriveRunActions(run("failed", { counters: { qualified_count: 0 }, lead_count: 0 }));
    expect(a.export.kind).toBe("disabled");
  });

  // --- the full table, one row per status, every column ---

  it("draft: start+editLimits enabled, everything else hidden or disabled with no results", () => {
    const a = deriveRunActions(run("draft"));
    expectEnabled(a.start);
    expectHidden(a.cancel);
    expectHidden(a.retry);
    expectHidden(a.rerun);
    expectEnabled(a.editLimits);
    expectHidden(a.answerClarification);
    expectDisabledWithReason(a.export);
  });

  it("queued: cancel enabled, start/editLimits disabled, everything terminal hidden", () => {
    const a = deriveRunActions(run("queued"));
    expectDisabledWithReason(a.start);
    expectEnabled(a.cancel);
    expectHidden(a.retry);
    expectHidden(a.rerun);
    expectDisabledWithReason(a.editLimits);
    expectHidden(a.answerClarification);
    expectDisabledWithReason(a.export);
  });

  it("running: cancel enabled, export gated on whether a lead has landed yet", () => {
    const noLeadsYet = deriveRunActions(run("running", { lead_count: 0 }));
    expectDisabledWithReason(noLeadsYet.start);
    expectEnabled(noLeadsYet.cancel);
    expectDisabledWithReason(noLeadsYet.retry);
    expectHidden(noLeadsYet.rerun);
    expectDisabledWithReason(noLeadsYet.editLimits);
    expectHidden(noLeadsYet.answerClarification);
    expectDisabledWithReason(noLeadsYet.export);

    const someLeadsSaved = deriveRunActions(run("running", { lead_count: 3 }));
    expectEnabled(someLeadsSaved.export);
  });

  it("awaiting_input: only cancel and answerClarification are actionable", () => {
    const a = deriveRunActions(run("awaiting_input"));
    expectDisabledWithReason(a.start);
    expectEnabled(a.cancel);
    expectHidden(a.retry);
    expectHidden(a.rerun);
    expectDisabledWithReason(a.editLimits);
    expectEnabled(a.answerClarification);
    expectDisabledWithReason(a.export);
  });

  it("completed: terminal, re-run and export enabled, nothing else offered", () => {
    const a = deriveRunActions(run("completed", { lead_count: 10 }));
    expectHidden(a.start);
    expectHidden(a.cancel);
    expectHidden(a.retry);
    expectEnabled(a.rerun);
    expectHidden(a.editLimits);
    expectHidden(a.answerClarification);
    expectEnabled(a.export);
  });

  it("partial: same shape as completed, re-run and export unconditionally enabled", () => {
    const a = deriveRunActions(run("partial", { lead_count: 6 }));
    expectHidden(a.start);
    expectHidden(a.cancel);
    expectHidden(a.retry);
    expectEnabled(a.rerun);
    expectHidden(a.editLimits);
    expectHidden(a.answerClarification);
    expectEnabled(a.export);
  });

  it("failed: retry and re-run enabled, export gated on whether any lead was saved", () => {
    const noLeads = deriveRunActions(run("failed", { lead_count: 0 }));
    expectHidden(noLeads.start);
    expectHidden(noLeads.cancel);
    expectEnabled(noLeads.retry);
    expectEnabled(noLeads.rerun);
    expectHidden(noLeads.editLimits);
    expectHidden(noLeads.answerClarification);
    expectDisabledWithReason(noLeads.export);

    const someLeads = deriveRunActions(run("failed", { lead_count: 4 }));
    expectEnabled(someLeads.export);
  });

  it("cancelled: re-run enabled, no retry, export gated on whether any lead was saved", () => {
    const noLeads = deriveRunActions(run("cancelled", { lead_count: 0 }));
    expectHidden(noLeads.start);
    expectHidden(noLeads.cancel);
    expectHidden(noLeads.retry);
    expectEnabled(noLeads.rerun);
    expectHidden(noLeads.editLimits);
    expectHidden(noLeads.answerClarification);
    expectDisabledWithReason(noLeads.export);

    const someLeads = deriveRunActions(run("cancelled", { lead_count: 2 }));
    expectEnabled(someLeads.export);
  });

  it("covers exactly the seven actions in the spec, no more, no fewer", () => {
    const a = deriveRunActions(run("draft"));
    expect(Object.keys(a).sort()).toEqual(
      ["answerClarification", "cancel", "editLimits", "export", "retry", "rerun", "start"].sort(),
    );
  });
});
