import type { ReactNode } from "react";
import { ErrorState } from "./error-state";

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.3: the five async-surface states are
 * Loading, Empty, Error, Partial/degraded, and Success. The first three
 * plus Success are genuine *fetch* states, handled here. Partial/degraded
 * (a `partial` run, a `needs_review` lead, a flagged draft) is a
 * *content* state within a successful fetch, not a fetch outcome - the
 * data came back fine, it just represents a degraded result - so it is
 * rendered by the `success` branch's own content (e.g. a StatusBadge with
 * `tone: "warning"`, a banner), not modeled as a fifth case here.
 */
export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string; onRetry?: () => void }
  | { status: "empty" }
  | { status: "success"; data: T };

export interface AsyncBoundaryProps<T> {
  state: AsyncState<T>;
  /** Shaped like the real content - never a bare centered spinner (§17.3). */
  skeleton: ReactNode;
  empty: ReactNode;
  children: (data: T) => ReactNode;
}

export function AsyncBoundary<T>({ state, skeleton, empty, children }: AsyncBoundaryProps<T>) {
  switch (state.status) {
    case "loading":
      return <>{skeleton}</>;
    case "error":
      return <ErrorState message={state.message} onRetry={state.onRetry} />;
    case "empty":
      return <>{empty}</>;
    case "success":
      return <>{children(state.data)}</>;
  }
}
