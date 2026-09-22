"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionButton } from "@/components/primitives/action-button";
import { cancelRun, retryRun, rerunRun } from "@/actions/runs";
import { deriveRunActions } from "@core/domain/run-actions";
import type { Run } from "@core/domain/types";

export interface ActionBarProps {
  run: Run;
  runId: string;
}

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.5: one function, `deriveRunActions`,
 * decides enabled/disabled/hidden for every action - this component
 * only renders what it returns, it never re-derives the decision itself.
 * `start` and `editLimits` are only ever `disabled` or `hidden` in this
 * app's real flow (every run is created directly into `queued`, never
 * `draft` - there is no draft-saving feature in this project's scope),
 * so their action callbacks exist only to satisfy `ActionButtonProps`'
 * required shape and are never expected to actually run.
 */
export function ActionBar({ run, runId }: ActionBarProps) {
  const router = useRouter();
  const actions = deriveRunActions(run);

  function showError(error: unknown) {
    toast.error(error instanceof Error ? error.message : "Something went wrong.");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton
        idleLabel="Start run"
        pendingLabel="Starting…"
        state={actions.start}
        action={() => {
          throw new Error("Starting a draft run is not available in this app.");
        }}
      />
      <ActionButton
        idleLabel="Cancel"
        pendingLabel="Cancelling…"
        variant="danger"
        state={actions.cancel}
        confirm={{
          title: "Cancel this run?",
          description: "The worker will stop as soon as it finishes its current step. Any leads already saved are kept.",
          confirmLabel: "Cancel run",
        }}
        action={async () => {
          const result = await cancelRun(runId);
          if (result.error) throw new Error(result.error);
          router.refresh();
        }}
        onError={showError}
      />
      <ActionButton
        idleLabel="Retry"
        pendingLabel="Retrying…"
        state={actions.retry}
        action={async () => {
          const result = await retryRun(runId);
          if (result.error) throw new Error(result.error);
          router.refresh();
        }}
        onError={showError}
      />
      <ActionButton
        idleLabel="Re-run"
        pendingLabel="Starting new run…"
        state={actions.rerun}
        action={async () => {
          const result = await rerunRun(runId);
          if (result.error) throw new Error(result.error);
          if (result.runId) router.push(`/runs/${result.runId}`);
        }}
        onError={showError}
      />
      <ActionButton
        idleLabel="Edit limits"
        state={actions.editLimits}
        action={() => {
          throw new Error("Editing limits on a draft run is not available in this app.");
        }}
      />
      <ActionButton
        idleLabel="Export sample pack"
        variant="secondary"
        state={actions.export}
        action={() => {
          router.push(`/runs/${runId}/sample-pack`);
        }}
      />
    </div>
  );
}
