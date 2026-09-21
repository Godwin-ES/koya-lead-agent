import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.3: states what failed, why, and what to do;
 * offers Retry; keeps the rest of the page usable. §17.12: the message is
 * human, the detail lives in system_errors, never a raw stack trace here.
 */
export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-6 py-8 text-center",
        className,
      )}
    >
      <AlertTriangle className="h-5 w-5 text-[var(--color-danger-text)]" aria-hidden="true" />
      <p className="max-w-sm text-sm text-[var(--color-danger-text)]">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-[var(--color-danger-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)]"
        >
          Retry
        </button>
      )}
    </div>
  );
}
