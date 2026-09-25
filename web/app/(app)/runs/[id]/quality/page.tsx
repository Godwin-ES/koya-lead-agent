import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRunById } from "@core/db/runs";
import { getQualityReportForRun } from "@core/db/quality";
import { EmptyState } from "@/components/primitives/empty-state";
import { CheckList, Scorecard } from "@/components/quality/check-list";
import { CheckCircle2, XCircle } from "lucide-react";
import type { QualityCheckResult, QualityScorecardEntry } from "@core/schemas/quality";
import { RunSummary } from "@/components/quality/run-summary";

export default async function QualityPage(props: PageProps<"/runs/[id]/quality">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const run = await getRunById(supabase, id);
  if (!run) notFound();

  const report = await getQualityReportForRun(supabase, id);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-lg font-semibold text-[var(--color-text)]">Quality report</h1>
      <p className="mb-4 truncate text-sm text-[var(--color-text-muted)]">{run.objective_raw}</p>

      {!report ? (
        <EmptyState
          title="No quality report yet"
          description="This run hasn't finished - the quality report is generated when it finalizes."
        />
      ) : (
        <div className="space-y-6">
          <div
            className={
              report.passed
                ? "flex items-center gap-2 rounded-md bg-[var(--color-success-bg)] px-3 py-2 text-sm text-[var(--color-success-text)]"
                : "flex items-center gap-2 rounded-md bg-[var(--color-warning-bg)] px-3 py-2 text-sm text-[var(--color-warning-text)]"
            }
          >
            {report.passed ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
            {report.passed ? "This run passed every quality check." : "This run did not pass every quality check."}
          </div>

          <RunSummary summary={report.summary} />

          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Required checks</h2>
            <CheckList checks={report.checks as QualityCheckResult[]} />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Scorecard</h2>
            <Scorecard scorecard={report.scorecard as QualityScorecardEntry[]} />
          </section>
        </div>
      )}
    </div>
  );
}
