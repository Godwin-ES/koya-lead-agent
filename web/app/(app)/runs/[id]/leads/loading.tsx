import { TableSkeleton } from "@/components/primitives/skeletons";

export default function LeadsLoading() {
  return (
    <div>
      <div className="mb-4 h-6 w-24 animate-pulse rounded-md bg-[var(--color-surface-2)]" aria-hidden="true" />
      <TableSkeleton rows={8} columns={5} />
    </div>
  );
}
