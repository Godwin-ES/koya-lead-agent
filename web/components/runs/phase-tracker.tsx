import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PHASE_IDS, phaseLabel, type PhaseState } from "@core/domain/phases";

export interface PhaseTrackerProps {
  phases: Record<string, PhaseState>;
  className?: string;
}

const STATE_CLASSES: Record<PhaseState, string> = {
  done: "border-[var(--color-success-text)] bg-[var(--color-success-bg)] text-[var(--color-success-text)]",
  current: "border-[var(--color-accent)] bg-[var(--color-info-bg)] text-[var(--color-info-text)]",
  pending: "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]",
};

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.7: reflects real recorded state only -
 * every dot's state comes from `derivePhases`, never from a timer.
 */
export function PhaseTracker({ phases, className }: PhaseTrackerProps) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-2", className)} aria-label="Run phases">
      {PHASE_IDS.map((id, i) => {
        const state = phases[id] ?? "pending";
        return (
          <li key={id} className="flex items-center gap-2">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                STATE_CLASSES[state],
              )}
              aria-current={state === "current" ? "step" : undefined}
            >
              {state === "done" && <Check className="h-3 w-3" aria-hidden="true" />}
              {state === "current" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
              {phaseLabel(id)}
              <span className="sr-only">
                {state === "done" ? " - done" : state === "current" ? " - in progress" : " - not started"}
              </span>
            </span>
            {i < PHASE_IDS.length - 1 && (
              <span className="h-px w-4 bg-[var(--color-border)]" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
