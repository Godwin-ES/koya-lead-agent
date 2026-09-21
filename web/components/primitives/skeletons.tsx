import { cn } from "@/lib/utils";

/** A single skeleton block. Compose these into shapes matching real content, never a bare spinner. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-[var(--color-surface-2)]", className)}
      aria-hidden="true"
    />
  );
}

/** Shaped like a table: header row + N body rows, matching the run/lead list layouts. */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="w-full" data-testid="table-skeleton">
      <div className="mb-2 flex gap-4">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={`h-${i}`} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="mb-2 flex gap-4">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Shaped like a card of key/value rows, matching the run view's summary panels. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-4" data-testid="card-skeleton">
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}
