"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionButton } from "@/components/primitives/action-button";
import { cancelRun, pauseRun, resumeRun, rerunRun, extendRun } from "@/actions/runs";
import { deriveRunActions } from "@core/domain/run-actions";
import { DeleteRunButton } from "./delete-run-button";
import type { Run } from "@core/domain/types";

export interface ActionBarProps {
  run: Run;
  runId: string;
  budget?: { searchesLeftToAdd: number; companiesPerSearch: number };
}

/** The actor's real pay-per-event pricing (providers/discovery/apify.ts) - an estimate shown, never a limit. */
const COST_PER_SEARCH_START_USD = 0.001;
const COST_PER_COMPANY_USD = 0.004;

function ContinueControl({ runId, state, budget }: { runId: string; state: ReturnType<typeof deriveRunActions>["extend"]; budget: { searchesLeftToAdd: number; companiesPerSearch: number } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searches, setSearches] = useState(Math.min(1, budget.searchesLeftToAdd));
  const selectId = useId();
  if (state.kind === "hidden") return null;

  const cost = searches * (COST_PER_SEARCH_START_USD + budget.companiesPerSearch * COST_PER_COMPANY_USD);
  const options = Array.from({ length: budget.searchesLeftToAdd + 1 }, (_, i) => i);

  if (!open || state.kind === "disabled") {
    return (
      <ActionButton idleLabel="Continue with more budget" state={state} action={() => setOpen(true)} />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
      <label htmlFor={selectId} className="text-sm text-[var(--color-text)]">
        Add searches
      </label>
      <select
        id={selectId}
        value={searches}
        onChange={(e) => setSearches(Number(e.target.value))}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]"
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span className="text-xs text-[var(--color-text-muted)]">
        {searches > 0 ? `up to ${searches * budget.companiesPerSearch} more companies, about $${cost.toFixed(2)} on Apify` : "no new searches - only more room for the limit it hit"}
      </span>
      <ActionButton
        idleLabel="Continue"
        pendingLabel="Queuing…"
        action={async () => {
          const result = await extendRun(runId, searches);
          if (result.error) throw new Error(result.error);
          setOpen(false);
          router.refresh();
        }}
        onError={(err) => toast.error(err instanceof Error ? err.message : "Couldn't continue the run.")}
      />
      <button type="button" onClick={() => setOpen(false)} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        Cancel
      </button>
    </div>
  );
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
export function ActionBar({ run, runId, budget = { searchesLeftToAdd: 0, companiesPerSearch: 0 } }: ActionBarProps) {
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
        idleLabel={actions.pause.kind === "disabled" ? "Pausing…" : "Pause"}
        pendingLabel="Pausing…"
        variant="secondary"
        state={actions.pause}
        action={async () => {
          const result = await pauseRun(runId);
          if (result.error) throw new Error(result.error);
          router.refresh();
        }}
        onError={showError}
      />
      <ActionButton
        idleLabel="Resume"
        pendingLabel="Resuming…"
        state={actions.resume}
        action={async () => {
          const result = await resumeRun(runId);
          if (result.error) throw new Error(result.error);
          router.refresh();
        }}
        onError={showError}
      />
      <ContinueControl runId={runId} state={actions.extend} budget={budget} />
      <ActionButton
        idleLabel="Run again"
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
      <DeleteRunButton runId={runId} state={actions.delete} afterDelete="runs" />
    </div>
  );
}
