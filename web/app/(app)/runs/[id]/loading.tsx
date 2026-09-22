import { CardSkeleton } from "@/components/primitives/skeletons";

export default function RunLoading() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-2/3 animate-pulse rounded-md bg-[var(--color-surface-2)]" aria-hidden="true" />
      <CardSkeleton lines={2} />
      <CardSkeleton lines={5} />
    </div>
  );
}
