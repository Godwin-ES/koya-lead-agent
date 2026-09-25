"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, ShieldAlert } from "lucide-react";
import { ActionButton } from "@/components/primitives/action-button";
import { CopyButton } from "@/components/leads/copy-button";
import { editDraft, revertDraft, setDraftApproval } from "@/actions/review";
import type { OutreachDraftRow } from "@core/db/row-types";

function label(draft: Pick<OutreachDraftRow, "channel" | "step">): string {
  return draft.channel === "email" ? `Email ${draft.step} of 3` : "LinkedIn message";
}

export function DraftCard({ draft }: { draft: OutreachDraftRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body);
  const [notes, setNotes] = useState<string[]>([]);
  const subjectId = useId();
  const bodyId = useId();
  const grounding = draft.grounding_check as { flagged?: boolean; unsupportedClaims?: string[] } | null;
  const isEmail = draft.channel === "email";

  function startEdit() {
    setSubject(draft.subject ?? "");
    setBody(draft.body);
    setNotes([]);
    setEditing(true);
  }

  return (
    <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{label(draft)}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.edited_at && <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">Edited by you</span>}
          {draft.approved_at ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-success-bg)] px-2 py-0.5 text-xs font-medium text-[var(--color-success-text)]">
              <Check className="h-3 w-3" aria-hidden="true" />
              Approved
            </span>
          ) : (
            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">Not approved</span>
          )}
        </div>
      </header>

      {grounding?.flagged && !editing && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-warning-bg)] px-4 py-2 text-xs text-[var(--color-warning-text)]">
          <p className="flex items-center gap-1 font-medium">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            Couldn&apos;t trace to the company&apos;s sources - check before sending:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {(grounding.unsupportedClaims ?? []).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {editing ? (
        <div className="space-y-3 p-4">
          {isEmail && (
            <div>
              <label htmlFor={subjectId} className="block text-xs font-medium text-[var(--color-text-muted)]">
                Subject
              </label>
              <input
                id={subjectId}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
              />
            </div>
          )}
          <div>
            <label htmlFor={bodyId} className="block text-xs font-medium text-[var(--color-text-muted)]">
              Message
            </label>
            <textarea
              id={bodyId}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={isEmail ? 12 : 5}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm leading-relaxed text-[var(--color-text)]"
            />
            {!isEmail && <p className="mt-1 text-right text-xs tabular-nums text-[var(--color-text-muted)]">{body.trim().length}/300</p>}
          </div>
          <div className="flex gap-2">
            <ActionButton
              idleLabel="Save changes"
              pendingLabel="Saving…"
              action={async () => {
                const result = await editDraft(draft.id, isEmail ? subject : null, body);
                if (result.error) throw new Error(result.error);
                const advisories = [...(result.warnings ?? []), ...(result.unsupportedClaims ?? []).map((c) => `Couldn't trace to the sources: "${c}"`)];
                setNotes(advisories);
                setEditing(false);
                toast.success(advisories.length ? "Saved - with notes to check" : "Saved");
                router.refresh();
              }}
              onError={(err) => toast.error(err instanceof Error ? err.message : "Couldn't save the edit.")}
            />
            <button type="button" onClick={() => setEditing(false)} className="rounded-md px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {isEmail && (
            <p className="border-b border-[var(--color-border)] px-4 py-2 text-sm">
              <span className="text-[var(--color-text-muted)]">Subject: </span>
              <span className="font-medium text-[var(--color-text)]">{draft.subject}</span>
            </p>
          )}
          <p className="whitespace-pre-line px-4 py-3 text-sm leading-relaxed text-[var(--color-text)]">{draft.body}</p>
          {notes.length > 0 && (
            <ul className="mx-4 mb-3 list-disc rounded-md bg-[var(--color-warning-bg)] py-2 pl-8 pr-3 text-xs text-[var(--color-warning-text)]">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] px-4 py-2">
            <ActionButton
              idleLabel={draft.approved_at ? "Unapprove" : "Approve"}
              pendingLabel="Saving…"
              variant={draft.approved_at ? "ghost" : "secondary"}
              action={async () => {
                const result = await setDraftApproval(draft.id, !draft.approved_at);
                if (result.error) throw new Error(result.error);
                router.refresh();
              }}
              onError={(err) => toast.error(err instanceof Error ? err.message : "Couldn't update approval.")}
            />
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </button>
            <CopyButton text={isEmail ? `Subject: ${draft.subject}\n\n${draft.body}` : draft.body} label="Copy" />
            {draft.edited_at && (
              <ActionButton
                idleLabel="Revert to agent's draft"
                pendingLabel="Reverting…"
                variant="ghost"
                confirm={{ title: "Revert this draft?", description: "Your edits are discarded and the agent's original draft is restored. Approval is cleared.", confirmLabel: "Revert" }}
                action={async () => {
                  const result = await revertDraft(draft.id);
                  if (result.error) throw new Error(result.error);
                  router.refresh();
                }}
                onError={(err) => toast.error(err instanceof Error ? err.message : "Couldn't revert.")}
                className="ml-auto gap-1.5"
              />
            )}
          </footer>
        </>
      )}
    </article>
  );
}

