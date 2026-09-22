"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/primitives/action-button";
import { answerClarification } from "@/actions/runs";

export interface ClarificationCardProps {
  runId: string;
  question: string;
}

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.7: "a focused inline card with the
 * question, an answer field, and a Resume action - not a modal that can
 * be dismissed and lost." Rendered only while `runs.status ===
 * "awaiting_input"` - the parent page owns that condition.
 */
export function ClarificationCard({ runId, question }: ClarificationCardProps) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");

  return (
    <div
      role="region"
      aria-label="Clarification needed"
      className="rounded-lg border border-[var(--color-warning-text)]/30 bg-[var(--color-warning-bg)] p-4"
    >
      <div className="flex items-start gap-3">
        <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warning-text)]" aria-hidden="true" />
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-sm font-medium text-[var(--color-warning-text)]">The agent needs one clarification before continuing</p>
            <p className="mt-1 text-sm text-[var(--color-text)]">{question}</p>
          </div>
          <label className="block text-sm">
            <span className="sr-only">Your answer</span>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={2}
              placeholder="Type your answer…"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            />
          </label>
          <ActionButton
            idleLabel="Resume run"
            pendingLabel="Resuming…"
            state={answer.trim().length === 0 ? { kind: "disabled", reason: "Enter an answer first" } : { kind: "enabled" }}
            action={async () => {
              const result = await answerClarification(runId, answer);
              if (result.error) throw new Error(result.error);
              setAnswer("");
              router.refresh();
            }}
            onError={(error) => toast.error(error instanceof Error ? error.message : "Could not resume the run.")}
          />
        </div>
      </div>
    </div>
  );
}
