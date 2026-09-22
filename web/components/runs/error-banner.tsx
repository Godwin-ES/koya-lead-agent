import { AlertTriangle } from "lucide-react";

export interface ErrorBannerProps {
  message: string;
}

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.7 / §17.12: "A run failure is a banner on
 * the run that stays until acknowledged, never a toast that vanishes
 * before it is read" and "no raw stack traces - the message is human,
 * the detail lives in system_errors." Always visible for a `failed` run;
 * never a toast, never auto-dismissed.
 */
export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] p-4"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-danger-text)]" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-[var(--color-danger-text)]">This run failed</p>
        <p className="mt-1 text-sm text-[var(--color-danger-text)]">{message}</p>
      </div>
    </div>
  );
}
