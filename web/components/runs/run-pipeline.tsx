import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Pipeline } from "@core/domain/pipeline";
import type { LeadQualificationStatus } from "@core/domain/types";

export interface RunPipelineProps {
  runId: string;
  pipeline: Pipeline;
  turns: number;
  toolCalls: number;
  className?: string;
}

function Stage({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="text-xs font-medium text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--color-text)]">{value}</div>
    </div>
  );
}

function Arrow() {
  return <ChevronRight className="h-4 w-4 shrink-0 self-center text-[var(--color-text-muted)]" aria-hidden="true" />;
}

function Outcome({ runId, status, label, value, tone }: { runId: string; status: LeadQualificationStatus; label: string; value: string; tone: string }) {
  return (
    <Link
      href={`/runs/${runId}/leads?status=${status}`}
      className="min-w-0 rounded-md px-2 py-1 -mx-2 -my-1 hover:bg-[var(--color-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
    >
      <div className="text-xs font-medium text-[var(--color-text-muted)]">{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", tone)}>{value}</div>
    </Link>
  );
}

/**
 * Where the run's candidates went, left to right: what discovery returned,
 * what passed the size/location/website check, what was scraped, and how
 * each saved lead was judged. Turns and tool calls sit on a second row in
 * the same format - diagnostics, but worth reading at a glance.
 */
export function RunPipeline({ runId, pipeline, turns, toolCalls, className }: RunPipelineProps) {
  return (
    <section aria-label="Run progress" className={cn("rounded-lg border border-[var(--color-border)] px-4 py-3", className)}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex items-start gap-3">
          <Stage label="Discovered" value={String(pipeline.discovered)} hint="Companies returned by LinkedIn discovery" />
          <Arrow />
          <Stage
            label="Kept"
            value={pipeline.kept === null ? "-" : String(pipeline.kept)}
            hint="Passed the size, location and website check"
          />
          <Arrow />
          <Stage label="Scraped" value={String(pipeline.scraped)} hint="Companies whose website was scraped" />
          <Arrow />
        </div>
        <div className="flex items-start gap-5 border-l border-[var(--color-border)] pl-4">
          <Outcome runId={runId} status="qualified" label="Qualified" value={String(pipeline.qualified)} tone="text-[var(--color-success-text)]" />
          <Outcome runId={runId} status="needs_review" label="Needs review" value={String(pipeline.needsReview)} tone="text-[var(--color-warning-text)]" />
          <Outcome runId={runId} status="not_qualified" label="Not qualified" value={String(pipeline.notQualified)} tone="text-[var(--color-text)]" />
        </div>
      </div>
      <div className="mt-3 flex items-start gap-6 border-t border-[var(--color-border)] pt-3">
        <Stage label="Turns" value={String(turns)} hint="Model turns used so far" />
        <Stage label="Tool calls" value={String(toolCalls)} hint="Tool calls made so far" />
      </div>
    </section>
  );
}
