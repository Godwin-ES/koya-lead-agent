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
  // Each state offers one way forward: Pause/Resume while a run isn't
  // finished, "Run again" (rerun) only once it is.

  it("draft: start+editLimits enabled, everything else hidden or disabled with no results", () => {
    const a = deriveRunActions(run("draft"));
    expectEnabled(a.start);
    expectHidden(a.cancel);
    expectHidden(a.pause);
    expectHidden(a.resume);
    expectHidden(a.rerun);
    expectEnabled(a.editLimits);
    expectHidden(a.answerClarification);
    expectDisabledWithReason(a.export);
  });

  it("queued: pause and cancel enabled, start/editLimits disabled", () => {
    const a = deriveRunActions(run("queued"));
    expectDisabledWithReason(a.start);
    expectEnabled(a.cancel);
    expectEnabled(a.pause);
    expectHidden(a.resume);
    expectHidden(a.rerun);
    expectDisabledWithReason(a.editLimits);
    expectHidden(a.answerClarification);
    expectDisabledWithReason(a.export);
  });

  it("running: pause and cancel enabled, export gated on whether a lead has landed yet", () => {
    const noLeadsYet = deriveRunActions(run("running", { lead_count: 0 }));
    expectDisabledWithReason(noLeadsYet.start);
    expectEnabled(noLeadsYet.cancel);
    expectEnabled(noLeadsYet.pause);
    expectHidden(noLeadsYet.resume);
    expectHidden(noLeadsYet.rerun);
    expectDisabledWithReason(noLeadsYet.editLimits);
    expectHidden(noLeadsYet.answerClarification);
    expectDisabledWithReason(noLeadsYet.export);

    const someLeadsSaved = deriveRunActions(run("running", { lead_count: 3 }));
    expectEnabled(someLeadsSaved.export);
  });

  it("running with a pause requested: pause shows as pausing until the worker reaches a safe point", () => {
    const a = deriveRunActions(run("running", { pause_requested: true }));
    expect(a.pause).toEqual({ kind: "disabled", reason: "Pausing - finishing the current step" });
    expectEnabled(a.cancel);
  });

  it("paused: resume and cancel enabled, export gated on whether a lead was saved", () => {
    const noLeads = deriveRunActions(run("paused", { lead_count: 0 }));
    expectHidden(noLeads.start);
    expectEnabled(noLeads.cancel);
    expectHidden(noLeads.pause);
    expectEnabled(noLeads.resume);
    expectHidden(noLeads.rerun);
    expectHidden(noLeads.editLimits);
    expectHidden(noLeads.answerClarification);
    expectDisabledWithReason(noLeads.export);

    expectEnabled(deriveRunActions(run("paused", { lead_count: 2 })).export);
  });

  it("awaiting_input: only cancel and answerClarification are actionable", () => {
    const a = deriveRunActions(run("awaiting_input"));
    expectDisabledWithReason(a.start);
    expectEnabled(a.cancel);
    expectHidden(a.pause);
    expectHidden(a.resume);
    expectHidden(a.rerun);
    expectDisabledWithReason(a.editLimits);
    expectEnabled(a.answerClarification);
    expectDisabledWithReason(a.export);
  });

  it("completed: run again and export enabled, nothing else offered", () => {
    const a = deriveRunActions(run("completed", { lead_count: 10 }));
    expectHidden(a.start);
    expectHidden(a.cancel);
    expectHidden(a.pause);
    expectHidden(a.resume);
    expectEnabled(a.rerun);
    expectHidden(a.editLimits);
    expectHidden(a.answerClarification);
    expectEnabled(a.export);
  });

  it("partial: it fell short, so it's continued with more budget - not run again from scratch", () => {
    const a = deriveRunActions(run("partial", { lead_count: 6 }));
    expectHidden(a.start);
    expectHidden(a.cancel);
    expectHidden(a.pause);
    expectHidden(a.resume);
    expectEnabled(a.extend);
    expectHidden(a.rerun);
    expectHidden(a.editLimits);
    expectHidden(a.answerClarification);
    expectEnabled(a.export);
  });

  it("failed: resume only (no run again), export gated on whether any lead was saved", () => {
    const noLeads = deriveRunActions(run("failed", { lead_count: 0 }));
    expectHidden(noLeads.start);
    expectHidden(noLeads.cancel);
    expectHidden(noLeads.pause);
    expectEnabled(noLeads.resume);
    expectHidden(noLeads.rerun);
    expectHidden(noLeads.editLimits);
    expectHidden(noLeads.answerClarification);
    expectDisabledWithReason(noLeads.export);

    const someLeads = deriveRunActions(run("failed", { lead_count: 4 }));
    expectEnabled(someLeads.export);
  });

  it("cancelled: run again enabled, no resume, export gated on whether any lead was saved", () => {
    const noLeads = deriveRunActions(run("cancelled", { lead_count: 0 }));
    expectHidden(noLeads.start);
    expectHidden(noLeads.cancel);
    expectHidden(noLeads.pause);
    expectHidden(noLeads.resume);
    expectEnabled(noLeads.rerun);
    expectHidden(noLeads.editLimits);
    expectHidden(noLeads.answerClarification);
    expectDisabledWithReason(noLeads.export);

    const someLeads = deriveRunActions(run("cancelled", { lead_count: 2 }));
    expectEnabled(someLeads.export);
  });

  it("partial: continuing is disabled, with the reason, once it stopped on searches and has the most it can have", () => {
    const a = deriveRunActions(run("partial", { lead_count: 6, limit_reached: "searches", searches_left_to_add: 0 }));
    expect(a.extend).toEqual({ kind: "disabled", reason: "This run already has the most searches allowed" });
    // Stopped on something else - e.g. turns - it can still be given room.
    expectEnabled(deriveRunActions(run("partial", { limit_reached: "turns", searches_left_to_add: 0 })).extend);
  });

  it("no state offers more than one way forward - resume, continue, or run again", () => {
    const statuses: Run["status"][] = ["draft", "queued", "running", "awaiting_input", "paused", "completed", "partial", "failed", "cancelled"];
    for (const status of statuses) {
      const a = deriveRunActions(run(status, { lead_count: 1 }));
      expect([a.resume, a.extend, a.rerun].filter((s) => s.kind === "enabled").length, status).toBeLessThanOrEqual(1);
    }
  });

  it("covers exactly the spec's actions, no more, no fewer", () => {
    const a = deriveRunActions(run("draft"));
    expect(Object.keys(a).sort()).toEqual(["answerClarification", "cancel", "delete", "editLimits", "export", "extend", "pause", "resume", "rerun", "start"].sort());
  });

describe("delete", () => {
  it("is available in every state except while a worker is running the run", () => {
    for (const status of ["draft", "queued", "awaiting_input", "paused", "completed", "partial", "failed", "cancelled"] as const) {
      expect(deriveRunActions(run(status)).delete, status).toEqual({ kind: "enabled" });
    }
    expect(deriveRunActions(run("running")).delete).toMatchObject({ kind: "disabled", reason: expect.stringMatching(/Pause or cancel the run first/) });
    expect(deriveRunActions(run("running", { pause_requested: true })).delete.kind).toBe("disabled");
  });
});
});
