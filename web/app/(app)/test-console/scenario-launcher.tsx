"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionButton } from "@/components/primitives/action-button";
import { launchFailureScenario } from "@/actions/test-console";
import { FAILURE_MODES, type FailureMode } from "@core/providers/failure-injection";

const DESCRIPTIONS: Record<FailureMode, { title: string; expected: string }> = {
  apify_auth_error: {
    title: "Apify auth/quota error",
    expected: "Run fails fast with the provider message surfaced; no retry loop.",
  },
  apify_empty_result: {
    title: "Apify returns 0 candidates",
    expected: "Run still finalizes, as partial - no crash on a thin result.",
  },
  sidecar_down: {
    title: "Crawl4AI sidecar down",
    expected: "Run fails with an actionable health-check message.",
  },
  model_429: {
    title: "Model API 429",
    expected: "Run fails with the provider's rate-limit reason.",
  },
  invalid_tool_input: {
    title: "Model returns invalid tool input",
    expected: "Returned to the agent as a recoverable error - the run still finishes.",
  },
  worker_kill: {
    title: "Worker crash mid-run",
    expected: "Run fails with a system_errors row (see BUILD-NOTES for the reclaim path, tested separately).",
  },
};

/**
 * SYSTEM-DESIGN-NEXTJS.md §13 "Failure injection": each launch creates a
 * new run seeded with the matching toggle and navigates straight to its
 * live view, all in replay mode - no live provider is ever touched, only
 * the injected failure path is exercised.
 */
export function ScenarioLauncher() {
  const router = useRouter();

  return (
    <div className="space-y-3">
      {FAILURE_MODES.map((mode) => {
        const { title, expected } = DESCRIPTIONS[mode];
        return (
          <div
            key={mode}
            data-testid={`scenario-${mode}`}
            className="flex items-center justify-between gap-4 rounded-lg border border-[var(--color-border)] p-4"
          >
            <div>
              <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{expected}</p>
            </div>
            <ActionButton
              idleLabel="Launch"
              pendingLabel="Launching…"
              variant="secondary"
              action={async () => {
                const result = await launchFailureScenario(mode);
                if (result.error) throw new Error(result.error);
                if (result.runId) router.push(`/runs/${result.runId}`);
              }}
              onError={(error) => toast.error(error instanceof Error ? error.message : "Could not launch this scenario.")}
            />
          </div>
        );
      })}
    </div>
  );
}
