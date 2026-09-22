import { TableSkeleton } from "@/components/primitives/skeletons";

export default function RunsLoading() {
  return (
    <div>
      <div className="mb-6 h-6 w-24 animate-pulse rounded-md bg-[var(--color-surface-2)]" aria-hidden="true" />
      <TableSkeleton rows={6} columns={4} />
    </div>
  );
}
