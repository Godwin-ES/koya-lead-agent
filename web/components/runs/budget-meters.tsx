import { cn } from "@/lib/utils";
import type { RunCounters } from "@core/domain/types";

export interface BudgetMetersProps {
  counters: RunCounters;
  className?: string;
}

interface Counter {
  label: string;
  value: number;
}

function CounterTile({ label, value }: Counter) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] px-3 py-2">
      <div className="text-xs font-medium text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-[var(--color-text)]">{value}</div>
    </div>
  );
}

/**
 * Plain running counts, not budget meters against a per-run ceiling -
 * deliberately removed the progress-bar/percentage/"Limit reached"
 * treatment (and the Spend counter entirely) after a real run showed
 * these numbers misleading rather than useful: the displayed spend was
 * computed from an inflated cost estimate, and the "/13" ceilings
 * implied per-run-tunable limits that no longer exist - candidate_limit,
 * scrape_limit, max_turns, and max_tool_calls are now fixed, generous
 * safety nets the user deliberately doesn't want surfaced as if they
 * were meaningful per-run dials (SYSTEM-DESIGN-NEXTJS.md's spend meter
 * is superseded by this decision, not this file misreading it).
 */
export function BudgetMeters({ counters, className }: BudgetMetersProps) {
  const tiles: Counter[] = [
    { label: "Candidates discovered", value: counters.candidates_seen ?? 0 },
    { label: "Sites scraped", value: counters.scrapes_used ?? 0 },
    { label: "Turns", value: counters.turns_used ?? 0 },
    { label: "Tool calls", value: counters.tool_calls_used ?? 0 },
  ];

  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
      {tiles.map((t) => (
        <CounterTile key={t.label} {...t} />
      ))}
    </div>
  );
}
