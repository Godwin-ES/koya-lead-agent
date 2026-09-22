"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/primitives/status-badge";
import { TOOL_CALL_STATUS } from "@core/domain/status";
import type { ToolCallRow, AgentEventRow } from "@core/db/row-types";

export interface TimelineProps {
  toolCalls: ToolCallRow[];
  agentEvents: AgentEventRow[];
  className?: string;
}

/** Groups tool calls under the phase they belong to, for the collapsible grouping §17.7 asks for. No explicit phase tag exists on tool_calls, so this is a static, deliberately simple mapping - good enough to group a timeline, not meant to be the phase tracker's own source of truth (packages/core/src/domain/phases.ts is that). */
const TOOL_TO_GROUP: Record<string, string> = {
  save_icp: "ICP",
  request_clarification: "ICP",
  discover_companies: "Discover",
  scrape_site: "Scrape",
  save_lead: "Qualify",
  save_outreach: "Draft",
  finalize_run: "Finalize",
  list_run_state: "Other",
};

function groupOf(toolName: string): string {
  return TOOL_TO_GROUP[toolName] ?? "Other";
}

function formatCost(cost: number | null): string | null {
  if (cost === null || cost === 0) return null;
  return `$${Number(cost).toFixed(4)}`;
}

function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function TimelineRow({ call }: { call: ToolCallRow }) {
  const entry = TOOL_CALL_STATUS[call.status];
  const isNotable = call.status === "denied" || call.status === "error";
  const reason = call.denial_reason ?? call.error_message;

  return (
    <li
      className={cn(
        "flex flex-col gap-1 border-b border-[var(--color-border)] px-3 py-2 text-sm last:border-b-0",
        isNotable && "bg-[var(--color-danger-bg)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">#{call.seq}</span>
        <span className="font-medium text-[var(--color-text)]">{call.tool_name}</span>
        <StatusBadge entry={entry} />
        {formatDuration(call.duration_ms) && (
          <span className="text-xs text-[var(--color-text-muted)]">{formatDuration(call.duration_ms)}</span>
        )}
        {formatCost(call.estimated_cost_usd) && (
          <span className="text-xs text-[var(--color-text-muted)]">{formatCost(call.estimated_cost_usd)}</span>
        )}
      </div>
      {isNotable && reason && (
        <p className="text-sm font-medium text-[var(--color-danger-text)]">{reason}</p>
      )}
      {!isNotable && call.result_summary && (
        <p className="text-xs text-[var(--color-text-muted)]">{call.result_summary}</p>
      )}
    </li>
  );
}

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.6/§17.7: grouped, collapsible, denials and
 * errors prominent. Sticks to bottom only when already at the bottom;
 * otherwise holds position and shows a "N new events" jump pill -
 * arriving events must never steal scroll position from someone reading
 * upward in the log.
 */
export function Timeline({ toolCalls, className }: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const prevLengthRef = useRef(toolCalls.length);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAtBottom(isAtBottom);
    if (isAtBottom) setNewCount(0);
  }

  useEffect(() => {
    const grew = toolCalls.length - prevLengthRef.current;
    if (grew > 0) {
      const el = containerRef.current;
      if (atBottom && el) {
        el.scrollTop = el.scrollHeight;
      } else if (!atBottom) {
        setNewCount((n) => n + grew);
      }
    }
    prevLengthRef.current = toolCalls.length;
    // Only re-run when the list actually grows - `atBottom` is read, not
    // depended on, so scrolling up/down doesn't itself trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolCalls.length]);

  function jumpToLatest() {
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setNewCount(0);
  }

  function toggleGroup(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const groups = new Map<string, ToolCallRow[]>();
  for (const call of toolCalls) {
    const key = groupOf(call.tool_name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(call);
  }

  return (
    <div className={cn("relative", className)}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        aria-live="polite"
        aria-label="Agent tool-call timeline"
        className="max-h-[32rem] overflow-y-auto rounded-lg border border-[var(--color-border)]"
      >
        {toolCalls.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]">
            No tool calls yet - they will appear here as the agent works.
          </p>
        ) : (
          [...groups.entries()].map(([groupName, calls]) => {
            const isCollapsed = collapsed.has(groupName);
            return (
              <div key={groupName}>
                <button
                  type="button"
                  onClick={() => toggleGroup(groupName)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)]"
                >
                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                  {groupName} ({calls.length})
                </button>
                {!isCollapsed && <ul>{calls.map((c) => <TimelineRow key={c.id} call={c} />)}</ul>}
              </div>
            );
          })
        )}
      </div>
      {newCount > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-[var(--color-accent-contrast)] shadow-lg hover:opacity-90"
        >
          {newCount} new event{newCount > 1 ? "s" : ""} — jump to latest
        </button>
      )}
    </div>
  );
}
