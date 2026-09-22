"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RunRow, ToolCallRow, AgentEventRow, CostLedgerRow } from "@core/db/row-types";

export type ConnectionState = "connected" | "reconnecting" | "disconnected";

export interface RunStreamData {
  run: RunRow;
  toolCalls: ToolCallRow[];
  agentEvents: AgentEventRow[];
  costLedger: CostLedgerRow[];
}

export interface UseRunStreamResult {
  data: RunStreamData;
  connectionState: ConnectionState;
  error: string | null;
  refetch: () => void;
}

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.6: a Realtime subscription on the run and
 * its three append-only child tables, a reconnecting banner with a
 * polling fallback, and a full refetch on reconnect ("On reconnect the
 * view refetches from scratch rather than assuming no events were
 * missed during the gap"). Deliberately does *not* own scroll position
 * or drawer state - it only ever appends to arrays or replaces the run
 * row, which is what lets Timeline/etc. decide for themselves whether
 * to auto-scroll (§17.6: incoming events must never steal scroll
 * position or close an open drawer, which this hook has no opinion on).
 */
export function useRunStream(runId: string, initial: RunStreamData): UseRunStreamResult {
  const [data, setData] = useState<RunStreamData>(initial);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connected");
  const [error, setError] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());

  const fetchAll = useCallback(async () => {
    const supabase = supabaseRef.current;
    const [runRes, toolCallsRes, agentEventsRes, costLedgerRes] = await Promise.all([
      supabase.from("runs").select().eq("id", runId).single(),
      supabase.from("tool_calls").select().eq("run_id", runId).order("seq", { ascending: true }),
      supabase.from("agent_events").select().eq("run_id", runId).order("seq", { ascending: true }),
      supabase.from("cost_ledger").select().eq("run_id", runId).order("created_at", { ascending: true }),
    ]);

    if (runRes.error || !runRes.data) {
      setError("Could not load this run. It may have been removed.");
      return;
    }

    setError(null);
    setData({
      run: runRes.data as RunRow,
      toolCalls: (toolCallsRes.data ?? []) as ToolCallRow[],
      agentEvents: (agentEventsRes.data ?? []) as AgentEventRow[],
      costLedger: (costLedgerRes.data ?? []) as CostLedgerRow[],
    });
  }, [runId]);

  useEffect(() => {
    const supabase = supabaseRef.current;
    let lastState: ConnectionState = "connected";

    const channel = supabase
      .channel(`run:${runId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "runs", filter: `id=eq.${runId}` }, (payload) => {
        if (payload.eventType === "DELETE") return;
        setData((prev) => ({ ...prev, run: payload.new as RunRow }));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tool_calls", filter: `run_id=eq.${runId}` }, (payload) => {
        setData((prev) => ({ ...prev, toolCalls: [...prev.toolCalls, payload.new as ToolCallRow] }));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_events", filter: `run_id=eq.${runId}` }, (payload) => {
        setData((prev) => ({ ...prev, agentEvents: [...prev.agentEvents, payload.new as AgentEventRow] }));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cost_ledger", filter: `run_id=eq.${runId}` }, (payload) => {
        setData((prev) => ({ ...prev, costLedger: [...prev.costLedger, payload.new as CostLedgerRow] }));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (lastState !== "connected") void fetchAll();
          lastState = "connected";
          setConnectionState("connected");
        } else if (status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
          lastState = "reconnecting";
          setConnectionState("reconnecting");
        } else if (status === "CLOSED") {
          lastState = "disconnected";
          setConnectionState("disconnected");
        }
      });

    // Polling fallback while the channel isn't connected (§17.6).
    const pollTimer = setInterval(() => {
      if (lastState !== "connected") void fetchAll();
    }, 5000);

    return () => {
      clearInterval(pollTimer);
      void supabase.removeChannel(channel);
    };
  }, [runId, fetchAll]);

  return { data, connectionState, error, refetch: fetchAll };
}
