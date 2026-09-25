import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A minimal in-memory stand-in for exactly the query/RPC shapes the tool
 * handlers and log.ts actually use (see packages/core/src/db/*.ts) - not
 * a general Supabase mock. Keeps tools/definitions.ts and tools/log.ts
 * unit-testable at $0 with no real database round trip, matching the
 * precedent in tests/unit/validation/gate.test.ts's fakeSupabase().
 */

type Row = Record<string, unknown>;

function randomId(): string {
  return `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function createFakeSupabase() {
  const tables: Record<string, Row[]> = {
    runs: [],
    leads: [],
    outreach_drafts: [],
    discovery_cache: [],
    scrape_cache: [],
    cost_ledger: [],
    tool_calls: [],
    /** Stand-in for auth.users: { id, user_metadata } - read by auth.admin.getUserById. */
    auth_users: [],
  };

  const toolCallSeqByRun = new Map<string, number>();

  function from(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    const filters: Array<{ col: string; val: unknown; op: "eq" | "gt" | "in" }> = [];

    function matches(row: Row): boolean {
      return filters.every(({ col, val, op }) => {
        if (op === "eq") return row[col] === val;
        if (op === "in") return (val as unknown[]).includes(row[col]);
        const rowVal = row[col];
        return typeof rowVal === "string" && typeof val === "string" && rowVal > val;
      });
    }

    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, val, op: "eq" });
        return builder;
      },
      gt(col: string, val: unknown) {
        filters.push({ col, val, op: "gt" });
        return builder;
      },
      in(col: string, val: unknown[]) {
        filters.push({ col, val, op: "in" });
        return builder;
      },
      order() {
        return builder;
      },
      async maybeSingle() {
        const matched = rows.filter(matches);
        return { data: matched[0] ?? null, error: null };
      },
      async single() {
        const matched = rows.filter(matches);
        if (!matched.length) return { data: null, error: { message: "not found" } };
        return { data: matched[0], error: null };
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        // Supports `await supabase.from(t).select().eq(...)` with no
        // terminal .single()/.maybeSingle() - list queries.
        return Promise.resolve({ data: rows.filter(matches), error: null }).then(resolve);
      },
      insert(values: Row) {
        const row: Row = { id: values.id ?? randomId(), created_at: new Date().toISOString(), ...values };
        rows.push(row);
        return {
          select() {
            return { async single() { return { data: row, error: null }; } };
          },
        };
      },
      update(patch: Row) {
        return {
          eq(col: string, val: unknown) {
            const idx = rows.findIndex((r) => r[col] === val);
            const updated = idx === -1 ? null : (rows[idx] = { ...rows[idx], ...patch });
            return {
              select() {
                return { async single() { return { data: updated, error: updated ? null : { message: "not found" } }; } };
              },
            };
          },
        };
      },
      upsert(values: Row, opts: { onConflict: string }) {
        const keys = opts.onConflict.split(",");
        const idx = rows.findIndex((r) => keys.every((k) => r[k] === values[k]));
        let row: Row;
        if (idx === -1) {
          row = { id: randomId(), created_at: new Date().toISOString(), ...values };
          rows.push(row);
        } else {
          row = { ...rows[idx], ...values };
          rows[idx] = row;
        }
        return {
          select() {
            return { async single() { return { data: row, error: null }; } };
          },
        };
      },
    };
    return builder;
  }

  /**
   * The real `supabase.rpc(...)` returns a builder synchronously (both
   * `.single()`-chainable and directly awaitable), not a Promise -
   * `record_tool_call`/`finalize_run` chain `.single()`, `run_summary` is
   * awaited directly. This mirrors that shape: `rpc()` itself must not be
   * `async`, or chaining `.single()` onto the Promise it would otherwise
   * return fails immediately.
   */
  function rpc(name: string, args: Record<string, unknown>) {
    async function compute(): Promise<unknown> {
      if (name === "record_tool_call") {
        const runId = args.p_run_id as string;
        const seq = (toolCallSeqByRun.get(runId) ?? 0) + 1;
        toolCallSeqByRun.set(runId, seq);
        const row: Row = {
          id: randomId(),
          run_id: runId,
          seq,
          tool_name: args.p_tool_name,
          status: args.p_status,
          purpose: args.purpose ?? null,
          input_summary: args.input_summary ?? null,
          result_summary: args.result_summary ?? null,
          error_message: args.error_message ?? null,
          denial_reason: args.denial_reason ?? null,
          duration_ms: args.duration_ms ?? null,
          estimated_cost_usd: args.estimated_cost_usd ?? null,
          result_data: args.p_result_data ?? null,
          created_at: new Date().toISOString(),
        };
        tables.tool_calls.push(row);
        return row;
      }

      if (name === "run_summary") {
        const runId = args.p_run_id as string;
        const run = tables.runs.find((r) => r.id === runId);
        const leads = tables.leads.filter((l) => l.run_id === runId);
        return {
          status: run?.status,
          limits: run?.limits,
          counters: run?.counters,
          qualified_count: leads.filter((l) => l.qualification_status === "qualified").length,
          needs_review_count: leads.filter((l) => l.qualification_status === "needs_review").length,
          not_qualified_count: leads.filter((l) => l.qualification_status === "not_qualified").length,
          tool_call_count: tables.tool_calls.filter((t) => t.run_id === runId).length,
        };
      }

      if (name === "merge_run_counters") {
        // Mirrors the real RPC's atomic `counters = counters || patch` -
        // a full replace here would silently reintroduce the exact bug
        // this RPC exists to close (see mergeRunCounters' own comment).
        const runId = args.p_run_id as string;
        const patch = args.p_patch as Record<string, unknown>;
        const idx = tables.runs.findIndex((r) => r.id === runId);
        if (idx === -1) throw new Error(`run ${runId} not found`);
        const current = (tables.runs[idx]!.counters ?? {}) as Record<string, unknown>;
        tables.runs[idx] = { ...tables.runs[idx], counters: { ...current, ...patch } };
        return tables.runs[idx];
      }

      if (name === "finalize_run") {
        const runId = args.p_run_id as string;
        const idx = tables.runs.findIndex((r) => r.id === runId);
        const qualifiedCount = tables.leads.filter((l) => l.run_id === runId && l.qualification_status === "qualified").length;
        const limits = (tables.runs[idx]?.limits ?? {}) as Record<string, number>;
        const target = limits.target_qualified ?? 10;
        const status = qualifiedCount >= target ? "completed" : "partial";
        tables.runs[idx] = { ...tables.runs[idx], status, finished_at: new Date().toISOString() };
        return tables.runs[idx];
      }

      throw new Error(`fake rpc not implemented: ${name}`);
    }

    return {
      single: async () => ({ data: await compute(), error: null }),
      then(resolve: (v: { data: unknown; error: null }) => unknown, reject?: (e: unknown) => unknown) {
        return compute().then((data) => resolve({ data, error: null }), reject);
      },
    };
  }

  return {
    client: {
      from,
      rpc,
      auth: {
        admin: {
          async getUserById(id: string) {
            const user = tables.auth_users.find((u) => u.id === id);
            return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "User not found" } };
          },
        },
      },
    } as unknown as SupabaseClient,
    tables,
    seed(table: string, row: Row) {
      (tables[table] ?? (tables[table] = [])).push({ id: row.id ?? randomId(), created_at: new Date().toISOString(), ...row });
    },
  };
}
