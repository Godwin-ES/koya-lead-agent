"use client";

import { AlertTriangle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { VALIDATION_VERDICT } from "@core/domain/status";
import type { ValidationResult } from "@core/validation/objective";

/**
 * SYSTEM-DESIGN-NEXTJS.md §7.2/§17.8: an inline flag beneath the
 * objective field, never a blocking modal. `vague` and friends offer
 * "Dismiss" and, when available, a one-click "Use this instead" rewrite;
 * `out_of_scope_unsafe` offers neither - the safety boundary quoted
 * verbatim, submit disabled.
 */
export function ValidationFlag({
  result,
  onDismiss,
  onApplyRewrite,
}: {
  result: ValidationResult;
  onDismiss: () => void;
  onApplyRewrite: (text: string) => void;
}) {
  if (result.severity === "none") return null;

  const entry = VALIDATION_VERDICT[result.verdict];
  const isAdvisory = result.severity === "advisory";
  const Icon = result.blocking ? ShieldAlert : AlertTriangle;

  return (
    <div
      role="alert"
      className={cn(
        "mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        result.blocking
          ? "border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] text-[var(--color-danger-text)]"
          : isAdvisory
            ? "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
            : "border-[var(--color-warning-bg)] bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]",
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-medium">{entry.label}</p>
        <p>{result.reason}</p>
        {result.missingCriteria.length > 0 && (
          <p className="mt-1 text-xs">Missing: {result.missingCriteria.join(", ").replace(/_/g, " ")}</p>
        )}
        {(result.dismissible || result.suggestedRewrite) && (
          <div className="mt-2 flex gap-3">
            {result.suggestedRewrite && (
              <button
                type="button"
                onClick={() => onApplyRewrite(result.suggestedRewrite!)}
                className="text-xs font-medium underline underline-offset-2"
              >
                Use this instead
              </button>
            )}
            {result.dismissible && (
              <button type="button" onClick={onDismiss} className="text-xs font-medium underline underline-offset-2">
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
