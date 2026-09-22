"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/primitives/error-state";

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.3/§17.12: "states what failed, why, and
 * what to do; offers Retry" / "no raw stack traces in the user-facing
 * UI - the message is human, the detail lives in system_errors." Covers
 * every route under (app) that doesn't define its own more specific
 * error.tsx - a real Next.js error boundary, not a decorative
 * component that was never actually reachable (see BUILD-NOTES-NEXTJS.md,
 * Task 21: this file, and every loading.tsx alongside it, didn't exist
 * until this task, even though ErrorState/AsyncBoundary/the skeleton
 * primitives were all built back in Task 6).
 */
export default function AppSectionError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      className="mx-auto mt-12 max-w-md"
      message="Something went wrong loading this page. The detail has been logged - try again, or go back and retry from there."
      onRetry={retry}
    />
  );
}
