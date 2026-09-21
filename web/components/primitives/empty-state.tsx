import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.3: explains what would be here and offers
 * the primary action. Never a bare "No data".
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--color-border)] px-6 py-12 text-center", className)}>
      <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
      <p className="max-w-sm text-sm text-[var(--color-text-muted)]">{description}</p>
      {action}
    </div>
  );
}
