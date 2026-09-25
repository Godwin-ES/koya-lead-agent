import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocked before importing objective.ts, per Vitest's hoisting rules -
 * validateObjective calls classifyObjective, and these tests need to
 * control exactly what it returns without a real model call.
 */
vi.mock("@core/validation/classifier", () => ({
  classifyObjective: vi.fn(),
}));

import { validateObjective } from "@core/validation/objective";
import { classifyObjective } from "@core/validation/classifier";

const mockedClassify = vi.mocked(classifyObjective);

/**
 * A minimal in-memory stand-in for the two query shapes objective.ts
 * actually uses against `objective_validations` - not a general Supabase
 * mock, just enough of the chainable builder to exercise the gate's own
 * logic without a real database.
 */
function fakeSupabase() {
  const rows = new Map<string, Record<string, unknown>>();

  return {
    _rows: rows,
    from(_table: string) {
      const filters: Record<string, unknown> = {};
      const excludes: Record<string, unknown> = {};
      return {
        select() {
          return this;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return this;
        },
        neq(column: string, value: unknown) {
          excludes[column] = value;
          return this;
        },
        async maybeSingle() {
          const key = `${filters.user_id}:${filters.objective_hash}`;
          const row = rows.get(key) ?? null;
          const excluded = row && Object.entries(excludes).some(([col, val]) => row[col] === val);
          return { data: excluded ? null : row, error: null };
        },
        async upsert(row: Record<string, unknown>) {
          const key = `${row.user_id}:${row.objective_hash}`;
          rows.set(key, row);
          return { error: null };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const u = "11111111-1111-1111-1111-111111111111";

describe("validateObjective (the gate)", () => {
  beforeEach(() => {
    mockedClassify.mockReset();
  });

  it("flags a vague objective but still permits submission (PRD scenario 1 depends on this)", async () => {
    mockedClassify.mockResolvedValue({
      verdict: "vague",
      confidence: 0.9,
      reason: "Missing geography and headcount.",
      missing_criteria: ["geography", "headcount_range"],
      suggested_rewrite: "Find 10 US B2B SaaS companies with 10-100 employees.",
    });

    const r = await validateObjective(fakeSupabase(), "find me some tech companies", u);
    expect(r.verdict).toBe("vague");
    expect(r.dismissible).toBe(true);
    expect(r.blocking).toBe(false);
    expect(r.missingCriteria.length).toBeGreaterThan(0);
  });

  it("blocks an unsafe scope request and refuses dismissal", async () => {
    mockedClassify.mockResolvedValue({
      verdict: "out_of_scope_unsafe",
      confidence: 0.95,
      reason: "Asks for personal emails and sending.",
      missing_criteria: [],
      suggested_rewrite: "",
    });

    const r = await validateObjective(fakeSupabase(), "find the founders personal emails and email them", u);
    expect(r.verdict).toBe("out_of_scope_unsafe");
    expect(r.dismissible).toBe(false);
    expect(r.blocking).toBe(true);
  });

  it("downgrades a low confidence verdict to advisory, never blocking", async () => {
    mockedClassify.mockResolvedValue({
      verdict: "incoherent",
      confidence: 0.4,
      reason: "Unclear phrasing.",
      missing_criteria: [],
      suggested_rewrite: "",
    });

    const r = await validateObjective(fakeSupabase(), "niche vertical saas for maritime freight operators here", u);
    expect(r.severity).toBe("advisory");
    expect(r.blocking).toBe(false);
  });

  it("never blocks on out_of_scope_unsafe when confidence is low", async () => {
    mockedClassify.mockResolvedValue({
      verdict: "out_of_scope_unsafe",
      confidence: 0.3,
      reason: "Possibly asks for emails, unsure.",
      missing_criteria: [],
      suggested_rewrite: "",
    });

    const r = await validateObjective(fakeSupabase(), "maybe find some contacts for outreach purposes please", u);
    expect(r.blocking).toBe(false);
    expect(r.severity).toBe("advisory");
  });

  // Decided before deployment: no run starts on an objective that couldn't be checked.
  it("blocks the run when the classifier is unavailable, after one retry", async () => {
    mockedClassify.mockReset();
    mockedClassify.mockRejectedValue(new Error("model unavailable"));

    const r = await validateObjective(fakeSupabase(), "find 10 us saas companies with a hundred employees", u);
    expect(r.verdict).toBe("unavailable");
    expect(r.blocking).toBe(true);
    expect(r.dismissible).toBe(false);
    expect(mockedClassify).toHaveBeenCalledTimes(2);
  });

  it("recovers on the retry when the first check call fails", async () => {
    mockedClassify.mockReset();
    mockedClassify.mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce({ verdict: "valid", confidence: 0.9, reason: "ok", missing_criteria: [], suggested_rewrite: "" });

    const r = await validateObjective(fakeSupabase(), "find 12 us saas companies with fifty employees", u);
    expect(r.verdict).toBe("valid");
    expect(r.blocking).toBe(false);
  });

  it("serves a repeated objective from cache without a second model call", async () => {
    mockedClassify.mockResolvedValue({
      verdict: "valid",
      confidence: 0.95,
      reason: "Specific enough.",
      missing_criteria: [],
      suggested_rewrite: "",
    });

    const db = fakeSupabase();
    const text = "Find 10 US B2B SaaS companies with 10 to 100 employees needing automation";

    const first = await validateObjective(db, text, u);
    expect(mockedClassify).toHaveBeenCalledTimes(1);
    expect(first.cached).toBe(false);

    const second = await validateObjective(db, text, u);
    expect(mockedClassify).toHaveBeenCalledTimes(1); // still 1 - no second call
    expect(second.cached).toBe(true);
    expect(second.verdict).toBe("valid");
  });

  // Real bug, found live: `persist()` upserts every result, including an
  // "unavailable" one, keyed on (user_id, objective_hash) - the very next
  // check of the exact same text then hit that cached row first and never
  // called the classifier again, permanently "stuck" on one transient
  // outage forever. Confirmed against a real Supabase project: a genuine
  // Gemini 503 got cached this way and every later check of the identical
  // text kept returning the stale "unavailable" verdict, even minutes
  // later once the outage had cleared.
  it("does not permanently cache a classifier outage - retries on the next check instead", async () => {
    // Two failures: the check itself and its one retry.
    mockedClassify.mockRejectedValueOnce(new Error("503 model unavailable"));
    mockedClassify.mockRejectedValueOnce(new Error("503 model unavailable"));
    mockedClassify.mockResolvedValueOnce({
      verdict: "valid",
      confidence: 0.95,
      reason: "Specific enough.",
      missing_criteria: [],
      suggested_rewrite: "",
    });

    const db = fakeSupabase();
    const text = "Find 10 US B2B SaaS companies with 10 to 100 employees needing automation";

    const first = await validateObjective(db, text, u);
    expect(first.verdict).toBe("unavailable");

    const second = await validateObjective(db, text, u);
    expect(mockedClassify).toHaveBeenCalledTimes(3);
    expect(second.verdict).toBe("valid");
  });

  it("shows no flag at all for a valid objective", async () => {
    mockedClassify.mockResolvedValue({
      verdict: "valid",
      confidence: 0.9,
      reason: "Specific and searchable.",
      missing_criteria: [],
      suggested_rewrite: "",
    });

    const r = await validateObjective(fakeSupabase(), "Find 10 US fintech companies with 20-80 employees", u);
    expect(r.severity).toBe("none");
    expect(r.dismissible).toBe(true);
  });

  it("stage 1 rejections still go through the same dismissible-flag path, never blocking", async () => {
    const r = await validateObjective(fakeSupabase(), "asdkjhasdkjh", u);
    expect(r.verdict).toBe("incoherent");
    expect(r.dismissible).toBe(true);
    expect(r.blocking).toBe(false);
    expect(mockedClassify).not.toHaveBeenCalled();
  });
});
