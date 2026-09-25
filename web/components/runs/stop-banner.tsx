import { stopReasonText, type StopDetails } from "@core/tools/finish-check";


/**
 * Why a finished run stopped where it did - from its own records, not the
 * model's summary - and, for one that fell short, what continuing would do.
 */
export function StopBanner({ details, canContinue }: { details: StopDetails; canContinue: boolean }) {
  if (details.qualified >= details.target) return null;
  return (
    <div role="status" className="rounded-lg border border-[var(--color-warning-text)]/30 bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning-text)]">
      <p className="font-medium">
        Stopped at {details.qualified} of {details.target} qualified: {stopReasonText(details)}
      </p>
      {canContinue && (
        <p className="mt-1">
          &ldquo;Continue with more budget&rdquo; adds searches and carries on from here - every lead, draft and company already found is kept.
        </p>
      )}
    </div>
  );
}
