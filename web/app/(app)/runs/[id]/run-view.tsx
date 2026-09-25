"use client";

import { WifiOff } from "lucide-react";
import { PhaseTracker } from "@/components/runs/phase-tracker";
import { RunPipeline } from "@/components/runs/run-pipeline";
import { Timeline } from "@/components/runs/timeline";
import { ActionBar } from "@/components/runs/action-bar";
import { ClarificationCard } from "@/components/runs/clarification-card";
import { ErrorBanner } from "@/components/runs/error-banner";
import { StopBanner } from "@/components/runs/stop-banner";
import { StatusBadge } from "@/components/primitives/status-badge";
import { useRunStream, type RunStreamData } from "@/lib/realtime/use-run-stream";
import { RUN_STATUS } from "@core/domain/status";
import { derivePhases } from "@core/domain/phases";
import { derivePipeline } from "@core/domain/pipeline";
import type { RunCounters } from "@core/domain/types";

export interface RunViewProps {
  runId: string;
  initial: RunStreamData;
  hasIcp: boolean;
  hasLeads: boolean;
  hasDrafts: boolean;
  /** domain -> status for leads a reviewer decided; they aren't in the tool-call stream. */
  reviewerDecisions: Record<string, string>;
  /** For "Continue with more budget" - worked out on the server. */
  budget: { searchesLeftToAdd: number; companiesPerSearch: number };
}

/** Failed and partial runs aren't final - one can be resumed, the other continued with more budget. */
const FINAL_STATUSES = new Set(["completed", "cancelled"]);

export function RunView({ runId, initial, hasIcp, hasLeads, hasDrafts, reviewerDecisions, budget }: RunViewProps) {
  const { data, connectionState, error, refetch } = useRunStream(runId, initial);
  const { run, toolCalls, agentEvents } = data;

  const counters = { qualified_count: 0, ...(run.counters as Record<string, number>) } as RunCounters;
  const isTerminal = FINAL_STATUSES.has(run.status);
  const pipeline = derivePipeline(toolCalls, counters.candidates_seen ?? 0, reviewerDecisions);
  const leadCount = pipeline.qualified + pipeline.needsReview + pipeline.notQualified;

  const phases = derivePhases({
    status: run.status,
    hasIcp,
    candidatesSeen: counters.candidates_seen ?? 0,
    scrapesUsed: counters.scrapes_used ?? 0,
    hasLeads,
    hasDrafts,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">{run.objective_raw}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge entry={RUN_STATUS[run.status]} />
            {isTerminal && (
              <span className="text-xs text-[var(--color-text-muted)]">This run is finished - the view below is final.</span>
            )}
            {run.status === "paused" && (
              <span className="text-xs text-[var(--color-text-muted)]">Paused. Resume continues from where it stopped - saved leads and progress are kept.</span>
            )}
            {run.status === "running" && run.pause_requested_at != null && (
              <span className="text-xs text-[var(--color-text-muted)]">Pausing after the current step finishes.</span>
            )}
            {run.status === "failed" && (
              <span className="text-xs text-[var(--color-text-muted)]">Resume continues from where it stopped once the problem below is fixed.</span>
            )}
          </div>
        </div>
        <ActionBar
          run={{
            status: run.status,
            counters,
            lead_count: Math.max(leadCount, hasLeads ? 1 : 0),
            pause_requested: run.pause_requested_at != null,
            limit_reached: run.stop_details?.limit_reached ?? null,
            searches_left_to_add: budget.searchesLeftToAdd,
          }}
          runId={runId}
          budget={budget}
        />
      </div>

      {connectionState !== "connected" && (
        <div role="status" className="flex items-center gap-2 rounded-md border border-[var(--color-warning-text)]/30 bg-[var(--color-warning-bg)] px-3 py-2 text-sm text-[var(--color-warning-text)]">
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          Reconnecting… showing the last known state, refreshing periodically until the connection is back.
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      {run.status === "failed" && run.failure_reason && <ErrorBanner message={run.failure_reason} />}

      {(run.status === "partial" || run.status === "completed") && run.stop_details && (
        <StopBanner details={run.stop_details} canContinue={run.status === "partial"} />
      )}

      {run.status === "awaiting_input" && run.clarification_question && (
        <ClarificationCard runId={runId} question={run.clarification_question} />
      )}

      <PhaseTracker phases={phases} />

      <RunPipeline
        runId={runId}
        pipeline={pipeline}
        turns={counters.turns_used ?? 0}
        toolCalls={counters.tool_calls_used ?? 0}
      />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Agent timeline</h2>
        <Timeline toolCalls={toolCalls} agentEvents={agentEvents} />
      </div>

      {error && (
        <button type="button" onClick={refetch} className="text-sm font-medium text-[var(--color-accent)] underline">
          Retry loading this run
        </button>
      )}
    </div>
  );
}
