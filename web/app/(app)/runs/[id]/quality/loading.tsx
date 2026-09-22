import { CardSkeleton } from "@/components/primitives/skeletons";

export default function QualityLoading() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-1/2 animate-pulse rounded-md bg-[var(--color-surface-2)]" aria-hidden="true" />
      <CardSkeleton lines={6} />
    </div>
  );
}
