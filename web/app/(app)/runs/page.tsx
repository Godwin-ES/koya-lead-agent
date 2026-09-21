import Link from "next/link";
import { listMyRuns } from "@/actions/runs";
import { StatusBadge } from "@/components/primitives/status-badge";
import { EmptyState } from "@/components/primitives/empty-state";
import { RUN_STATUS } from "@core/domain/status";

export default async function RunsPage() {
  const runs = await listMyRuns();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">Runs</h1>
        <Link
          href="/runs/new"
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-contrast)] hover:opacity-90"
        >
          New run
        </Link>
      </div>

      {runs.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No runs yet"
          description="Start your first lead research run to see it here."
          action={
            <Link href="/runs/new" className="text-sm font-medium text-[var(--color-accent)] underline">
              Start a run
            </Link>
          }
        />
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
              <th className="py-2 font-medium">Objective</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Qualified</th>
              <th className="py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b border-[var(--color-border)]">
                <td className="max-w-sm truncate py-2 text-[var(--color-text)]">
                  <Link href={`/runs/${run.id}`} className="hover:underline">
                    {run.objective_raw}
                  </Link>
                </td>
                <td className="py-2">
                  <StatusBadge entry={RUN_STATUS[run.status]} />
                </td>
                <td className="py-2 text-[var(--color-text-muted)]">{run.counters.qualified_count ?? 0}</td>
                <td className="py-2 text-[var(--color-text-muted)]">
                  {new Date(run.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
