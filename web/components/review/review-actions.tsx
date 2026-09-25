"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionButton } from "@/components/primitives/action-button";
import { reviewLead } from "@/actions/review";
import type { LeadQualificationStatus } from "@core/domain/types";

interface Choice {
  key: string;
  label: string;
  status: LeadQualificationStatus;
  draft: boolean;
  prompt: string;
  variant: "primary" | "secondary";
}

function choicesFor(status: LeadQualificationStatus, hasSources: boolean): Choice[] {
  const qualify: Choice[] = hasSources
    ? [
        { key: "qualify-draft", label: "Qualify & draft outreach", status: "qualified", draft: true, prompt: "Why does this company qualify?", variant: "primary" },
        { key: "qualify", label: "Qualify only", status: "qualified", draft: false, prompt: "Why does this company qualify?", variant: "secondary" },
      ]
    : [];
  const notQualified: Choice = { key: "not", label: "Mark not qualified", status: "not_qualified", draft: false, prompt: "Why doesn't it qualify?", variant: "secondary" };
  const review: Choice = { key: "review", label: "Move to needs review", status: "needs_review", draft: false, prompt: "What still needs checking?", variant: "secondary" };

  if (status === "qualified") return [notQualified, review];
  if (status === "needs_review") return [...qualify, notQualified];
  return [...qualify, review];
}

export function ReviewActions({ leadId, status, hasSources }: { leadId: string; status: LeadQualificationStatus; hasSources: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<Choice | null>(null);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const choices = choicesFor(status, hasSources);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              setOpen(c);
              setReason("");
            }}
            aria-expanded={open?.key === c.key}
            className={
              c.variant === "primary"
                ? "rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-accent-contrast)] hover:opacity-90"
                : "rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
            }
          >
            {c.label}
          </button>
        ))}
      </div>
      {!hasSources && status !== "qualified" && (
        <p className="text-xs text-[var(--color-text-muted)]">This lead has no source pages, so it can&apos;t be qualified - there&apos;s no evidence to draft outreach from.</p>
      )}

      {open && (
        <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <label htmlFor={reasonId} className="block text-sm font-medium text-[var(--color-text)]">
            {open.prompt}
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. Their team page lists about 40 staff, inside the 10-100 range."
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
          />
          <div className="flex gap-2">
            <ActionButton
              idleLabel={open.label}
              pendingLabel="Saving…"
              state={reason.trim() ? undefined : { kind: "disabled", reason: "Add a short reason first" }}
              action={async () => {
                const result = await reviewLead(leadId, open.status, reason, open.draft);
                if (result.error) throw new Error(result.error);
                toast.success(open.draft ? "Qualified - drafting outreach" : "Decision saved");
                setOpen(null);
                router.refresh();
              }}
              onError={(err) => toast.error(err instanceof Error ? err.message : "Couldn't save the decision.")}
            />
            <button type="button" onClick={() => setOpen(null)} className="rounded-md px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
