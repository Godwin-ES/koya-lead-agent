"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionButton } from "@/components/primitives/action-button";
import { deleteRun } from "@/actions/runs";
import type { ActionState } from "@core/domain/types";

/**
 * Deletes a run and everything saved for it, after a confirmation. Used on
 * the run page (then back to /runs) and on each row of the runs list.
 */
export function DeleteRunButton({ runId, state, afterDelete = "refresh", className }: { runId: string; state: ActionState; afterDelete?: "refresh" | "runs"; className?: string }) {
  const router = useRouter();
  return (
    <ActionButton
      idleLabel="Delete"
      pendingLabel="Deleting…"
      variant={afterDelete === "runs" ? "danger" : "ghost"}
      className={className}
      state={state}
      confirm={{
        title: "Delete this run?",
        description: "This permanently deletes the run and everything saved for it: its leads, outreach drafts, reviews, timeline, cost records and quality report. It can't be undone.",
        confirmLabel: "Delete run",
      }}
      action={async () => {
        const result = await deleteRun(runId);
        if (result.error) throw new Error(result.error);
        toast.success("Run deleted.");
        if (afterDelete === "runs") router.push("/runs");
        else router.refresh();
      }}
      onError={(err) => toast.error(err instanceof Error ? err.message : "Couldn't delete the run.")}
    />
  );
}
