"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { ActionButton } from "@/components/primitives/action-button";
import { requestDrafts } from "@/actions/review";
import { DraftCard } from "./draft-card";
import type { DraftRequestRow, OutreachDraftRow } from "@core/db/row-types";

const SLOTS = [
  { channel: "email", step: 1, label: "Email 1 of 3" },
  { channel: "email", step: 2, label: "Email 2 of 3" },
  { channel: "email", step: 3, label: "Email 3 of 3" },
  { channel: "linkedin", step: 1, label: "LinkedIn message" },
] as const;

const POLL_MS = 3_000;

export interface OutreachEditorProps {
  leadId: string;
  qualified: boolean;
  drafts: OutreachDraftRow[];
  request: DraftRequestRow | null;
}

/** A lead's full outreach sequence: each draft to read, edit and approve, and the missing ones to ask the agent for. */
export function OutreachEditor({ leadId, qualified, drafts, request }: OutreachEditorProps) {
  const router = useRouter();
  const drafting = request?.status === "queued" || request?.status === "running";
  const missing = SLOTS.filter((s) => !drafts.some((d) => d.channel === s.channel && d.step === s.step));

  // While the worker drafts, keep the page current so drafts appear as they're saved.
  useEffect(() => {
    if (!drafting) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [drafting, router]);

  if (!qualified && drafts.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Outreach is drafted for qualified leads only. Qualify this lead on the Decision tab to draft it.</p>;
  }

  return (
    <div className="space-y-4">
      {drafting && (
        <p role="status" className="flex items-center gap-2 rounded-md bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {request?.status === "queued" ? "Waiting for the worker to start drafting…" : "Drafting outreach - drafts appear here as they're saved."}
        </p>
      )}
      {request?.status === "failed" && !drafting && missing.length > 0 && (
        <p role="alert" className="rounded-md bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
          The last drafting attempt didn&apos;t finish: {request.error}
        </p>
      )}
      {qualified && missing.length > 0 && !drafting && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-[var(--color-border)] px-3 py-2">
          <p className="text-sm text-[var(--color-text)]">
            {missing.length === 4 ? "No outreach drafted yet." : `Missing: ${missing.map((m) => m.label).join(", ")}.`}
          </p>
          <ActionButton
            idleLabel={missing.length === 4 ? "Draft outreach" : "Draft the missing ones"}
            pendingLabel="Queuing…"
            action={async () => {
              const result = await requestDrafts(leadId);
              if (result.error) throw new Error(result.error);
              toast.success("Drafting queued");
              router.refresh();
            }}
            onError={(err) => toast.error(err instanceof Error ? err.message : "Couldn't queue drafting.")}
          />
        </div>
      )}

      {SLOTS.map((slot) => {
        const draft = drafts.find((d) => d.channel === slot.channel && d.step === slot.step);
        return draft ? (
          <DraftCard key={draft.id} draft={draft} />
        ) : (
          <div key={slot.label} className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{slot.label}</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Not drafted yet.</p>
          </div>
        );
      })}
    </div>
  );
}
