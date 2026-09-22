import { cn } from "@/lib/utils";
import type { RunLimits, RunCounters } from "@core/domain/types";

export interface BudgetMetersProps {
  limits: RunLimits;
  counters: RunCounters;
  spentUsd: number;
  className?: string;
}

interface Meter {
  label: string;
  used: number;
  limit: number;
  format?: (n: number) => string;
}

function usd(n: number): string {
  return `$${n.toFixed(3)}`;
}

/** SYSTEM-DESIGN-NEXTJS.md §17.7: amber at 80%, red + "Limit reached" at 100%. */
function toneFor(used: number, limit: number): "neutral" | "warning" | "danger" {
  if (limit <= 0) return "neutral";
  const pct = (used / limit) * 100;
  if (pct >= 100) return "danger";
  if (pct >= 80) return "warning";
  return "neutral";
}

const BAR_CLASSES = {
  neutral: "bg-[var(--color-accent)]",
  warning: "bg-[var(--color-warning-text)]",
  danger: "bg-[var(--color-danger-text)]",
} as const;

const TEXT_CLASSES = {
  neutral: "text-[var(--color-text-muted)]",
  warning: "text-[var(--color-warning-text)]",
  danger: "text-[var(--color-danger-text)]",
} as const;

function MeterBar({ label, used, limit, format }: Meter) {
  const tone = toneFor(used, limit);
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const fmt = format ?? ((n: number) => String(n));

  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-[var(--color-text)]">{label}</span>
        <span className={cn(TEXT_CLASSES[tone])}>
          {fmt(used)} / {fmt(limit)}
          {tone === "danger" && " - Limit reached"}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(used)}
        aria-valuemin={0}
        aria-valuemax={limit}
      >
        <div className={cn("h-full rounded-full transition-[width]", BAR_CLASSES[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.7: "Cost is visible while the run happens,
 * not discovered afterwards." Five meters - spend, candidates, scrapes,
 * turns, tool calls - each amber at 80%, red and labelled "Limit
 * reached" at 100%.
 */
export function BudgetMeters({ limits, counters, spentUsd, className }: BudgetMetersProps) {
  const meters: Meter[] = [
    { label: "Spend", used: spentUsd, limit: limits.max_spend_usd, format: usd },
    { label: "Candidates", used: counters.candidates_seen ?? 0, limit: limits.candidate_limit },
    { label: "Scrapes", used: counters.scrapes_used ?? 0, limit: limits.scrape_limit },
    { label: "Turns", used: counters.turns_used ?? 0, limit: limits.max_turns },
    { label: "Tool calls", used: counters.tool_calls_used ?? 0, limit: limits.max_tool_calls },
  ];

  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5", className)}>
      {meters.map((m) => (
        <MeterBar key={m.label} {...m} />
      ))}
    </div>
  );
}
